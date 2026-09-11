import { CfnOutput, Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import {
  CorsHttpMethod,
  HttpApi,
  HttpMethod,
  HttpNoneAuthorizer,
  type IHttpRouteAuthorizer,
} from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpUserPoolAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import type * as cognito from 'aws-cdk-lib/aws-cognito';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import type * as s3 from 'aws-cdk-lib/aws-s3';
import type * as sqs from 'aws-cdk-lib/aws-sqs';
import type { Construct } from 'constructs';
import * as path from 'node:path';
import type { DerfStackProps } from './config';

export interface ApiStackProps extends DerfStackProps {
  readonly userPool: cognito.IUserPool;
  readonly userPoolClient: cognito.IUserPoolClient;
  readonly reportsTable: dynamodb.ITable;
  readonly reportImagesBucket: s3.IBucket;
  /** Submissions are handed off here rather than written synchronously. */
  readonly reportsQueue: sqs.IQueue;
}

/** Where the handler sources live, relative to this file. */
const HANDLERS_DIR = path.join(__dirname, '..', '..', 'services', 'src', 'handlers');

/**
 * API Gateway plus the request-handling Lambdas.
 *
 * These Lambdas are deliberately **not** in a VPC. They only talk to AWS APIs,
 * and a VPC would pull in a NAT Gateway at ~US$32/month — the entire budget.
 */
export class ApiStack extends Stack {
  public readonly httpApi: HttpApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);
    const { config } = props;

    /**
     * Every route is authenticated unless it explicitly opts out below.
     *
     * Setting this as the API-wide default makes the system fail closed: a route
     * added later without thinking about auth is protected, rather than being
     * silently public until someone notices.
     */
    const authorizer = new HttpUserPoolAuthorizer('UserPoolAuthorizer', props.userPool, {
      userPoolClients: [props.userPoolClient],
    });

    /** Marks a route as deliberately public. */
    const publicRoute: IHttpRouteAuthorizer = new HttpNoneAuthorizer();

    this.httpApi = new HttpApi(this, 'HttpApi', {
      apiName: config.resourceName('api'),
      description: 'Disaster & Emergency Resource Finder API',
      defaultAuthorizer: authorizer,
      corsPreflight: {
        // TODO(M6): replace with the CloudFront distribution domain.
        allowOrigins: ['*'],
        allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.POST, CorsHttpMethod.OPTIONS],
        allowHeaders: ['authorization', 'content-type'],
        maxAge: Duration.hours(1),
      },
    });

    /**
     * Builds a bundled Node Lambda.
     *
     * Log groups are created explicitly rather than via the `logRetention` prop:
     * that prop provisions a custom-resource Lambda and IAM role to set retention
     * after the fact, which is IAM surface this project avoids. Retention matters
     * regardless — log groups default to never expiring, and that storage is
     * billed forever.
     */
    const createHandler = (
      id: string,
      entryFile: string,
      environment: Record<string, string> = {},
    ): NodejsFunction => {
      const logGroup = new logs.LogGroup(this, `${id}LogGroup`, {
        logGroupName: `/aws/lambda/${config.resourceName(id.toLowerCase())}`,
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: RemovalPolicy.DESTROY,
      });

      return new NodejsFunction(this, id, {
        functionName: config.resourceName(id.toLowerCase()),
        entry: path.join(HANDLERS_DIR, entryFile),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_22_X,
        // Graviton: cheaper per millisecond than x86 at identical performance here.
        architecture: lambda.Architecture.ARM_64,
        memorySize: 256,
        timeout: Duration.seconds(10),
        logGroup,
        bundling: {
          minify: true,
          sourceMap: true,
        },
        environment: {
          DERF_STAGE: config.stage,
          // Lets stack traces from minified bundles point at real source lines.
          NODE_OPTIONS: '--enable-source-maps',
          ...environment,
        },
      });
    };

    const healthFn = createHandler('Health', 'health.ts');
    const meFn = createHandler('Me', 'me.ts');
    const listReportsFn = createHandler('ListReports', 'reports-list.ts', {
      REPORTS_TABLE: props.reportsTable.tableName,
    });
    const createReportFn = createHandler('CreateReport', 'reports-create.ts', {
      REPORTS_QUEUE_URL: props.reportsQueue.queueUrl,
      // Still referenced deliberately: pre-signed image uploads are an open M5
      // item and belong on this handler. Dropping it would also delete the
      // Storage stack's export for this bucket, which CloudFormation refuses to
      // do while the API stack still imports it.
      IMAGES_BUCKET: props.reportImagesBucket.bucketName,
    });

    // Grants are made only where the code actually reads or writes.
    //
    // `grantReadData` would also permit dynamodb:Scan, which this handler never
    // does — and a Scan against the reports table is precisely the expensive
    // mistake the geohash key schema exists to prevent. Granting the single
    // action the code uses means the policy cannot drift from the behaviour.
    props.reportsTable.grant(listReportsFn, 'dynamodb:Query');

    // The submission handler never touches the table at all; it can only enqueue.
    props.reportsQueue.grantSendMessages(createReportFn);

    this.httpApi.addRoutes({
      path: '/health',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration('HealthIntegration', healthFn),
      // Public: it is a liveness probe, and requiring a token would defeat it.
      authorizer: publicRoute,
    });

    this.httpApi.addRoutes({
      path: '/me',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration('MeIntegration', meFn),
      // Authenticated via the API default.
    });

    this.httpApi.addRoutes({
      path: '/reports',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration('ListReportsIntegration', listReportsFn),
      // Public: during a disaster, finding a shelter must not require an account.
      authorizer: publicRoute,
    });

    this.httpApi.addRoutes({
      path: '/reports',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('CreateReportIntegration', createReportFn),
      // Authenticated via the API default — submissions are attributable.
    });

    new CfnOutput(this, 'ApiUrl', {
      value: this.httpApi.apiEndpoint,
      description: 'Set as VITE_API_BASE_URL in the repo-root .env',
    });
  }
}
