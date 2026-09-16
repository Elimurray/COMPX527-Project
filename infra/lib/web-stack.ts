import { CfnOutput, Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';
import type { DerfStackProps } from './config';

/**
 * CloudFront in front of the frontend bucket.
 *
 * The bucket stays private: Origin Access Control lets this distribution read
 * it, and nothing else can. That is why the bucket was never configured for S3
 * static website hosting, which would have required making it public.
 *
 * Deliberately no `BucketDeployment` construct. It would upload the built site
 * for us, but only by provisioning a custom-resource Lambda and IAM role — the
 * same machinery removed from StorageStack. `npm run deploy:web` does the upload
 * with `aws s3 sync` instead, which is also exactly what the M8 pipeline runs.
 */
export class WebStack extends Stack {
  public readonly distribution: cloudfront.Distribution;
  /** Private bucket holding the built frontend. */
  public readonly frontendBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: DerfStackProps) {
    super(scope, id, props);
    const { config } = props;

    /**
     * The bucket lives here rather than in StorageStack because Origin Access
     * Control attaches a bucket policy that names the distribution. Splitting
     * the two across stacks makes each depend on the other.
     *
     * No websiteIndexDocument: S3 static website hosting requires a public
     * bucket, and OAC lets CloudFront read a private one instead.
     */
    this.frontendBucket = new s3.Bucket(this, 'FrontendBucket', {
      bucketName: config.bucketName('web'),
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: config.isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    const origin = origins.S3BucketOrigin.withOriginAccessControl(this.frontendBucket);

    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: `derf-${config.stage} resource map`,
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        // Vite fingerprints asset filenames, so cached objects are immutable and
        // a new build produces new names rather than needing an invalidation.
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress: true,
      },

      /**
       * The app is a single page: any unknown path must return index.html so the
       * client can route it, rather than CloudFront's XML error document.
       * `index.html` itself is served with a short TTL below, so a redeploy is
       * picked up quickly even before an invalidation lands.
       */
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: Duration.minutes(5),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: Duration.minutes(5),
        },
      ],

      // All edge locations, including Oceania. The alternative price classes are
      // cheaper per GB but exclude this project's actual audience, and demo-scale
      // traffic sits inside the CloudFront free tier either way.
      priceClass: cloudfront.PriceClass.PRICE_CLASS_ALL,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      enableLogging: false,
    });

    new CfnOutput(this, 'FrontendBucketName', {
      value: this.frontendBucket.bucketName,
      description: 'Target of npm run deploy:web',
    });
    new CfnOutput(this, 'DistributionDomain', {
      value: `https://${this.distribution.distributionDomainName}`,
      description: 'Public URL of the resource map',
    });
    new CfnOutput(this, 'DistributionId', {
      value: this.distribution.distributionId,
      description: 'Used by npm run deploy:web to invalidate the cache',
    });
  }
}
