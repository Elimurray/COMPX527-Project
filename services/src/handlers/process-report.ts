import { PublishCommand } from '@aws-sdk/client-sns';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import type { SQSBatchResponse, SQSHandler, SQSRecord } from 'aws-lambda';
import {
  CAPACITY_ALERT_THRESHOLD,
  COARSE_GEOHASH_PRECISION,
  REPORT_TTL_DAYS,
  geohashForPoint,
  reportSortKey,
  type CreateReportInput,
  type ReportItem,
} from '@derf/shared';
import { ddb, requireEnv, sns } from '../lib/clients';
import { logger } from '../lib/logger';

/** The envelope the API Lambda puts on the queue. */
interface QueuedReport {
  reportId: string;
  reportedBy: string;
  reportedAt: string;
  input: CreateReportInput;
}

const TABLE = requireEnv('REPORTS_TABLE');
const TOPIC_ARN = requireEnv('ALERTS_TOPIC_ARN');

/**
 * Should this report interrupt someone?
 *
 * Deliberately narrow. A notification that fires for every report trains people
 * to ignore notifications, which is worse than sending none during an emergency.
 */
function isNotable(input: CreateReportInput): boolean {
  if (input.status === 'unavailable') return true;

  const capacity = input.capacity;
  if (capacity && capacity.maximum > 0) {
    return capacity.current / capacity.maximum >= CAPACITY_ALERT_THRESHOLD;
  }

  return false;
}

async function processOne(record: SQSRecord): Promise<void> {
  const queued = JSON.parse(record.body) as QueuedReport;
  const geohash = geohashForPoint(queued.input.location);
  const reportedAtId = reportSortKey(queued.reportedAt, queued.reportId);

  const item: ReportItem = {
    ...queued.input,
    reportId: queued.reportId,
    reportedBy: queued.reportedBy,
    reportedAt: queued.reportedAt,
    geohash,
    // A prefix of `geohash`, not a second encode: geohash is a prefix code, so
    // the coarse cell is literally the first few characters of the fine one.
    geohash3: geohash.slice(0, COARSE_GEOHASH_PRECISION),
    reportedAtId,
    // TTL is in epoch *seconds*. Milliseconds here would set an expiry roughly
    // 50,000 years out, and nothing would ever be cleaned up.
    expiresAt: Math.floor(Date.now() / 1000) + REPORT_TTL_DAYS * 24 * 60 * 60,
  };

  try {
    await ddb.send(
      new PutCommand({
        TableName: TABLE,
        Item: item,
        // Idempotency: SQS guarantees at-least-once delivery, so the same report
        // can legitimately arrive twice. The composite key is unique per report,
        // so a duplicate fails this condition instead of overwriting.
        ConditionExpression:
          'attribute_not_exists(geohash) AND attribute_not_exists(reportedAtId)',
      }),
    );
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      logger.info('duplicate delivery ignored', {
        reportId: queued.reportId,
        messageId: record.messageId,
      });
      return;
    }
    throw error;
  }

  logger.info('report stored', {
    reportId: queued.reportId,
    geohash,
    resourceType: queued.input.resourceType,
    status: queued.input.status,
  });

  if (!isNotable(queued.input)) return;

  await sns.send(
    new PublishCommand({
      TopicArn: TOPIC_ARN,
      Subject: `${queued.input.resourceType} update`,
      Message: JSON.stringify({
        reportId: queued.reportId,
        resourceType: queued.input.resourceType,
        status: queued.input.status,
        location: queued.input.location,
        note: queued.input.note,
      }),
      // Message attributes, not body fields, because SNS subscription filter
      // policies can only match on attributes. This is what lets a subscriber
      // receive alerts for their own area rather than every report nationwide.
      MessageAttributes: {
        geohash: { DataType: 'String', StringValue: geohash },
        resourceType: { DataType: 'String', StringValue: queued.input.resourceType },
        status: { DataType: 'String', StringValue: queued.input.status },
      },
    }),
  );

  logger.info('alert published', { reportId: queued.reportId, geohash });
}

/**
 * SQS consumer: queue -> DynamoDB -> conditional SNS alert.
 *
 * Returns partial batch failures rather than throwing. Without this, one bad
 * message in a batch of ten would fail the whole batch, so nine already-written
 * reports would be redelivered and eventually land in the dead-letter queue
 * despite having succeeded.
 */
export const handler: SQSHandler = async (event): Promise<SQSBatchResponse> => {
  const batchItemFailures: SQSBatchResponse['batchItemFailures'] = [];

  const results = await Promise.allSettled(event.Records.map(processOne));

  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      const record = event.Records[index];
      logger.error('report processing failed', {
        messageId: record?.messageId,
        reason: String(result.reason),
      });
      if (record) {
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }
  });

  return { batchItemFailures };
};
