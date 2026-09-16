import { CfnOutput, Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';
import type { DerfStackProps } from './config';

/**
 * Durable state: the S3 buckets and the DynamoDB reports table.
 *
 * Kept in its own stack because these resources outlive everything else. The API
 * and pipeline stacks get redeployed constantly; the data stores should not be
 * caught up in that, and separating them means a bad API deploy can never roll
 * back into a table replacement.
 */
export class StorageStack extends Stack {
  /** NOAA/FEMA datasets and map tiles. */
  public readonly datasetsBucket: s3.Bucket;
  /** Photos attached to community reports, uploaded via pre-signed URLs. */
  public readonly reportImagesBucket: s3.Bucket;
  /** Live community reports. */
  public readonly reportsTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: DerfStackProps) {
    super(scope, id, props);
    const { config } = props;

    // Dev stacks are disposable; prod refuses to delete data stores by accident.
    //
    // `autoDeleteObjects` is deliberately NOT set. It would let CDK empty the
    // buckets during teardown, but only by adding a Lambda plus an IAM role
    // holding s3:DeleteObject* and s3:PutBucketPolicy over every bucket — IAM
    // surface this project would rather not carry. The trade-off is that
    // `cdk destroy` fails on a non-empty bucket, so empty them manually first
    // (see README, "Tearing down"). Orphaned buckets bill quietly against a
    // NZ$60 ceiling, so that step is not optional.
    const removalPolicy = config.isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

    /**
     * Settings every bucket in this project shares.
     *
     * S3_MANAGED (SSE-S3) rather than a KMS key: both satisfy "encryption at
     * rest", but a customer-managed KMS key costs ~US$1/month plus per-request
     * charges, which is real money at this budget. Revisit only if the data
     * classification changes.
     */
    const commonBucketProps: s3.BucketProps = {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      // Denies any request made over plain HTTP.
      enforceSSL: true,
      removalPolicy,
      lifecycleRules: [
        {
          // Failed multipart uploads are invisible in the console but still
          // billed as storage. Clean them up.
          abortIncompleteMultipartUploadAfter: Duration.days(7),
        },
      ],
    };

    this.datasetsBucket = new s3.Bucket(this, 'DatasetsBucket', {
      ...commonBucketProps,
      bucketName: config.bucketName('data'),
      lifecycleRules: [
        ...(commonBucketProps.lifecycleRules ?? []),
        {
          // Raw NOAA/FEMA pulls are read once during transform and then rarely
          // touched. Infrequent Access is roughly half the storage price.
          id: 'raw-to-infrequent-access',
          prefix: 'raw/',
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: Duration.days(30),
            },
          ],
        },
      ],
    });

    this.reportImagesBucket = new s3.Bucket(this, 'ReportImagesBucket', {
      ...commonBucketProps,
      bucketName: config.bucketName('images'),
      cors: [
        {
          // Browsers upload straight to S3 with a pre-signed URL, so the bucket
          // itself must accept the cross-origin PUT.
          // TODO(M6): replace '*' with the CloudFront distribution domain.
          allowedOrigins: ['*'],
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET, s3.HttpMethods.HEAD],
          allowedHeaders: ['*'],
          maxAge: 3000,
        },
      ],
    });

    // The frontend bucket lives in WebStack, not here. Origin Access Control
    // attaches a bucket policy referencing the CloudFront distribution, so a
    // bucket in this stack plus a distribution in another creates a dependency
    // cycle between the two stacks. Bucket and distribution must share a stack.

    /**
     * Reports table.
     *
     * Key schema:
     *   PK `geohash`  — geohash prefix at GEOHASH_PRECISION (~5km cell). "Nearby"
     *                   reads query the viewer's cell plus its eight neighbours
     *                   in parallel, so every read is a bounded Query rather
     *                   than a Scan.
     *   SK `reportedAtId` — `<ISO timestamp>#<reportId>`. ISO-8601 sorts
     *                   lexicographically, so range queries on time still work
     *                   exactly as a bare timestamp would, while the appended
     *                   reportId keeps two reports filed in the same cell in the
     *                   same millisecond from overwriting each other. During a
     *                   surge — the scenario this whole system exists for — that
     *                   collision is realistic, and a bare timestamp SK would
     *                   silently lose one of the reports.
     *                   Build it with `reportSortKey()` from @derf/shared.
     */
    this.reportsTable = new dynamodb.Table(this, 'ReportsTable', {
      tableName: config.resourceName('reports'),
      partitionKey: { name: 'geohash', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'reportedAtId', type: dynamodb.AttributeType.STRING },
      // On-demand: costs nothing when idle, and absorbs a surge without the
      // provisioned-capacity throttling this system is meant to survive.
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      // Reports describe a fast-moving situation. TTL expires stale rows for
      // free, which also keeps storage bounded without a cleanup job.
      timeToLiveAttribute: 'expiresAt',
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: config.isProd,
      },
      removalPolicy,
    });

    new CfnOutput(this, 'DatasetsBucketName', { value: this.datasetsBucket.bucketName });
    new CfnOutput(this, 'ReportImagesBucketName', {
      value: this.reportImagesBucket.bucketName,
    });
    new CfnOutput(this, 'ReportsTableName', { value: this.reportsTable.tableName });
  }
}
