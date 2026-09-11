import { CfnOutput, Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import type { Construct } from 'constructs';
import * as path from 'node:path';
import type { DerfStackProps } from './config';

export interface PipelineStackProps extends DerfStackProps {
  /** Processed reports are written here. */
  readonly reportsTable: dynamodb.ITable;
}

const HANDLERS_DIR = path.join(__dirname, '..', '..', 'services', 'src', 'handlers');

/** Processing timeout, and the visibility window derived from it. */
const PROCESSING_TIMEOUT = Duration.seconds(30);

/**
 * The report-processing pipeline: SQS -> Lambda -> DynamoDB -> SNS.
 *
 * This is the *data* pipeline, not CI/CD — the deployment pipeline is M8.
 */
export class PipelineStack extends Stack {
  /** The API Lambda sends submissions here. */
  public readonly reportsQueue: sqs.Queue;
  /** Where reports that repeatedly fail processing end up. */
  public readonly deadLetterQueue: sqs.Queue;
  /** Community notifications — subscribers filter by geohash. */
  public readonly alertsTopic: sns.Topic;
  /** Operational alarms for the team, kept separate from user notifications. */
  public readonly opsTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: PipelineStackProps) {
    super(scope, id, props);
    const { config } = props;

    /**
     * Dead-letter queue.
     *
     * Not optional. Without it, a report that fails processing is retried until
     * SQS gives up and drops it — silently, during exactly the surge the queue
     * exists to absorb. Retention is the 14-day maximum, because a failure that
     * happens mid-disaster may not be investigated until well afterwards.
     */
    this.deadLetterQueue = new sqs.Queue(this, 'ReportsDlq', {
      queueName: config.resourceName('reports-dlq'),
      retentionPeriod: Duration.days(14),
      enforceSSL: true,
      removalPolicy: config.isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    this.reportsQueue = new sqs.Queue(this, 'ReportsQueue', {
      queueName: config.resourceName('reports'),
      // Six times the processing timeout: the standard safety margin, so a slow
      // invocation cannot have its message become visible and redelivered while
      // the first attempt is still running.
      visibilityTimeout: Duration.seconds(PROCESSING_TIMEOUT.toSeconds() * 6),
      retentionPeriod: Duration.days(4),
      enforceSSL: true,
      deadLetterQueue: {
        queue: this.deadLetterQueue,
        // Three attempts. Enough to ride out a transient DynamoDB throttle,
        // few enough that a genuinely poisoned message stops burning invocations.
        maxReceiveCount: 3,
      },
      removalPolicy: config.isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    /**
     * One topic for community alerts, with per-subscription filter policies on
     * the `geohash` message attribute.
     *
     * The alternative — a topic per region — would mean creating and discovering
     * topics dynamically as the map is panned. Filter policies keep it to one
     * durable ARN, and SNS does the matching server-side, so a subscriber is
     * never woken for an area they did not ask about.
     */
    this.alertsTopic = new sns.Topic(this, 'AlertsTopic', {
      topicName: config.resourceName('alerts'),
      displayName: 'DERF resource alerts',
    });

    this.opsTopic = new sns.Topic(this, 'OpsTopic', {
      topicName: config.resourceName('ops-alerts'),
      displayName: 'DERF operational alarms',
    });

    const processorLogGroup = new logs.LogGroup(this, 'ProcessReportLogGroup', {
      logGroupName: `/aws/lambda/${config.resourceName('processreport')}`,
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const processorFn = new NodejsFunction(this, 'ProcessReport', {
      functionName: config.resourceName('processreport'),
      entry: path.join(HANDLERS_DIR, 'process-report.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: PROCESSING_TIMEOUT,
      logGroup: processorLogGroup,
      bundling: { minify: true, sourceMap: true },
      environment: {
        DERF_STAGE: config.stage,
        NODE_OPTIONS: '--enable-source-maps',
        REPORTS_TABLE: props.reportsTable.tableName,
        ALERTS_TOPIC_ARN: this.alertsTopic.topicArn,
      },
    });

    processorFn.addEventSource(
      new SqsEventSource(this.reportsQueue, {
        batchSize: 10,
        maxBatchingWindow: Duration.seconds(5),
        // Lets the handler fail individual messages. Without it, one bad message
        // fails the whole batch and drags already-written reports to the DLQ.
        reportBatchItemFailures: true,
      }),
    );

    // The first real IAM grants in this project, each narrowed to the single
    // action the code performs.
    //
    // `grantWriteData` would also permit UpdateItem, DeleteItem and
    // BatchWriteItem. The processor only ever conditionally puts a new report,
    // so nothing in this system is permitted to modify or delete a report that
    // has already been stored — a useful property to be able to state plainly.
    props.reportsTable.grant(processorFn, 'dynamodb:PutItem');
    this.alertsTopic.grantPublish(processorFn);

    /**
     * Anything in the dead-letter queue means reports were accepted from users
     * and then lost. There is no acceptable steady-state count, so the threshold
     * is zero rather than a tolerance band.
     */
    const dlqAlarm = new cloudwatch.Alarm(this, 'DlqNotEmptyAlarm', {
      alarmName: config.resourceName('reports-dlq-not-empty'),
      alarmDescription:
        'Reports failed processing and were dead-lettered. Each message is a report a user submitted and the system lost.',
      metric: this.deadLetterQueue.metricApproximateNumberOfMessagesVisible({
        period: Duration.minutes(1),
        statistic: 'Maximum',
      }),
      threshold: 0,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    dlqAlarm.addAlarmAction(new cwActions.SnsAction(this.opsTopic));

    new CfnOutput(this, 'ReportsQueueUrl', { value: this.reportsQueue.queueUrl });
    new CfnOutput(this, 'DeadLetterQueueUrl', { value: this.deadLetterQueue.queueUrl });
    new CfnOutput(this, 'AlertsTopicArn', { value: this.alertsTopic.topicArn });
    new CfnOutput(this, 'OpsTopicArn', {
      value: this.opsTopic.topicArn,
      description: 'Subscribe an email here to receive DLQ alarms',
    });
  }
}
