import { Stack } from 'aws-cdk-lib';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import type { Construct } from 'constructs';
import type { DerfStackProps } from './config';

export interface PipelineStackProps extends DerfStackProps {
  /** Processed reports are written here. */
  readonly reportsTable: dynamodb.ITable;
}

/**
 * The report-processing pipeline: SQS -> processing Lambda -> DynamoDB -> SNS.
 *
 * Note this is the *data* pipeline, not CI/CD — the deployment pipeline is M8 and
 * lives outside this stack.
 *
 * TODO(M5):
 *  - SQS queue fronting report submission, **with a dead-letter queue**. The DLQ
 *    is not optional: without it, reports that fail processing vanish silently
 *    during exactly the surge the queue exists to absorb.
 *  - Processing Lambda consuming the queue, idempotent on reportId, writing with
 *    the composite sort key from `reportSortKey()` in @derf/shared.
 *  - SNS topic(s) for notifications, with the targeting model still to be decided
 *    (topic-per-region vs subscription filter policies — see PROGRESS.md).
 *  - A CloudWatch alarm on DLQ depth > 0, wired to SNS.
 */
export class PipelineStack extends Stack {
  constructor(scope: Construct, id: string, props: PipelineStackProps) {
    super(scope, id, props);
  }
}
