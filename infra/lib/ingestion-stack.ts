import { CfnOutput, Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventTargets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import type * as s3 from 'aws-cdk-lib/aws-s3';
import type * as sns from 'aws-cdk-lib/aws-sns';
import type { Construct } from 'constructs';
import * as path from 'node:path';
import type { DerfStackProps } from './config';

export interface IngestionStackProps extends DerfStackProps {
  readonly datasetsBucket: s3.IBucket;
  readonly stationsTable: dynamodb.ITable;
  /** Operational alarms go here, not to community subscribers. */
  readonly opsTopic: sns.ITopic;
}

const HANDLERS_DIR = path.join(__dirname, '..', '..', 'services', 'src', 'handlers');

/** The AWS Registry of Open Data bucket holding NOAA GHCN-Daily. */
const NOAA_GHCN_BUCKET = 'noaa-ghcn-pds';

/**
 * Scheduled ingestion of NOAA GHCN-Daily data from the AWS Registry of Open Data.
 *
 * Kept separate from the live report pipeline because the two have nothing in
 * common operationally: this runs weekly against a third-party dataset, while the
 * pipeline runs continuously against user submissions. A failure here degrades a
 * contextual map layer; a failure there loses a user's report.
 */
export class IngestionStack extends Stack {
  constructor(scope: Construct, id: string, props: IngestionStackProps) {
    super(scope, id, props);
    const { config } = props;

    const logGroup = new logs.LogGroup(this, 'IngestNoaaLogGroup', {
      logGroupName: `/aws/lambda/${config.resourceName('ingestnoaa')}`,
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const ingestFn = new NodejsFunction(this, 'IngestNoaa', {
      functionName: config.resourceName('ingestnoaa'),
      entry: path.join(HANDLERS_DIR, 'ingest-noaa.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      // The stations file is ~11 MB and is parsed in memory; more memory also
      // buys proportionally more CPU, which shortens the run.
      memorySize: 1024,
      // Each of the ~15 stations needs a ranged S3 read. Generous, but this runs
      // weekly and is billed per millisecond actually used.
      timeout: Duration.minutes(5),
      logGroup,
      bundling: { minify: true, sourceMap: true },
      environment: {
        DERF_STAGE: config.stage,
        NODE_OPTIONS: '--enable-source-maps',
        DATASETS_BUCKET: props.datasetsBucket.bucketName,
        STATIONS_TABLE: props.stationsTable.tableName,
        GHCN_COUNTRY_PREFIX: 'NZ',
      },
    });

    /**
     * Cross-account read of the public NOAA bucket.
     *
     * The bucket policy on `noaa-ghcn-pds` permits anonymous reads, but our own
     * IAM must still allow the call. The grant is scoped to that one bucket —
     * this function cannot read any other S3 bucket in or outside the account.
     */
    ingestFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [`arn:aws:s3:::${NOAA_GHCN_BUCKET}/*`],
      }),
    );

    // Write only, and only under the raw NOAA prefix — the ingestion job has no
    // reason to read back or to touch report images or frontend assets.
    ingestFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:PutObject'],
        resources: [`${props.datasetsBucket.bucketArn}/raw/noaa/*`],
      }),
    );

    props.stationsTable.grant(ingestFn, 'dynamodb:PutItem');

    /**
     * Weekly refresh.
     *
     * GHCN is a historical observation archive updated daily at best, so a live
     * or even hourly poll would spend money to learn nothing. Sunday 15:00 UTC is
     * early Monday in New Zealand, so a week's data is in place before anyone
     * looks at it.
     */
    const schedule = new events.Rule(this, 'WeeklyIngestion', {
      ruleName: config.resourceName('noaa-weekly'),
      description: 'Refreshes NOAA GHCN station data from the Registry of Open Data',
      schedule: events.Schedule.cron({ weekDay: 'SUN', hour: '15', minute: '0' }),
    });
    schedule.addTarget(new eventTargets.LambdaFunction(ingestFn));

    /**
     * A silent ingestion failure is the dangerous kind: the map keeps showing
     * last week's data and nothing indicates it is stale.
     */
    const failureAlarm = new cloudwatch.Alarm(this, 'IngestionFailureAlarm', {
      alarmName: config.resourceName('noaa-ingestion-failed'),
      alarmDescription:
        'NOAA ingestion errored. The station layer is now serving stale data until this is fixed.',
      metric: ingestFn.metricErrors({ period: Duration.hours(1), statistic: 'Sum' }),
      threshold: 0,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    failureAlarm.addAlarmAction(new cwActions.SnsAction(props.opsTopic));

    new CfnOutput(this, 'IngestionFunctionName', {
      value: ingestFn.functionName,
      description:
        'Invoke manually with: aws lambda invoke --function-name <this> out.json',
    });
  }
}
