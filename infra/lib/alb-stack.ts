import { CfnOutput, Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as targets from 'aws-cdk-lib/aws-elasticloadbalancingv2-targets';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';
import * as path from 'node:path';
import type { DerfStackProps } from './config';

export interface AlbStackProps extends DerfStackProps {
  readonly reportsTable: dynamodb.ITable;
}

const HANDLERS_DIR = path.join(__dirname, '..', '..', 'services', 'src', 'handlers');

/**
 * Application Load Balancer ingress for the public read path.
 *
 * **This is the only stack in the project that costs money while idle** — an ALB
 * bills roughly US$16–22/month regardless of traffic. It is kept in its own stack
 * precisely so it can be destroyed independently:
 *
 *     npx cdk destroy Derf-dev-Alb
 *
 * Architecturally the system does not need a load balancer: API Gateway already
 * routes, scales and terminates TLS, and Lambda has no instances to balance
 * across. The ALB is included to satisfy the assignment's service requirement,
 * and is used for something real rather than left idle — it serves the same
 * public read endpoints as the API, which makes the two ingresses directly
 * comparable.
 *
 * One consequence worth stating: this listener is **HTTP only**. Terminating TLS
 * on an ALB requires a certificate from AWS Certificate Manager, which this
 * assignment prohibits. API Gateway provides HTTPS with no certificate management
 * at all, so on transport security the API Gateway path is strictly better.
 */
export class AlbStack extends Stack {
  public readonly loadBalancer: elbv2.ApplicationLoadBalancer;

  constructor(scope: Construct, id: string, props: AlbStackProps) {
    super(scope, id, props);
    const { config } = props;

    /**
     * Public subnets only, across two availability zones (an ALB requires at
     * least two).
     *
     * `natGateways: 0` is the important line. CDK's default VPC configuration
     * creates private subnets with a NAT Gateway per AZ at roughly US$32/month
     * each — which would consume the entire project budget several times over.
     * Nothing here needs outbound access from a private subnet: the Lambda
     * target is invoked by the load balancer rather than reached over the
     * network, and it is not VPC-attached at all.
     */
    const vpc = new ec2.Vpc(this, 'Vpc', {
      vpcName: config.resourceName('vpc'),
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
      ],
    });

    const logGroup = new logs.LogGroup(this, 'AlbReportsLogGroup', {
      logGroupName: `/aws/lambda/${config.resourceName('albreports')}`,
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const albReportsFn = new NodejsFunction(this, 'AlbReports', {
      functionName: config.resourceName('albreports'),
      entry: path.join(HANDLERS_DIR, 'alb-reports.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(10),
      logGroup,
      bundling: { minify: true, sourceMap: true },
      environment: {
        DERF_STAGE: config.stage,
        NODE_OPTIONS: '--enable-source-maps',
        REPORTS_TABLE: props.reportsTable.tableName,
      },
    });

    // Same narrow grant as the API Gateway read path: Query and nothing else,
    // extended to index ARNs so the wide-area GSI is reachable.
    albReportsFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:Query'],
        resources: [
          props.reportsTable.tableArn,
          `${props.reportsTable.tableArn}/index/*`,
        ],
      }),
    );

    this.loadBalancer = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      loadBalancerName: config.resourceName('alb'),
      vpc,
      internetFacing: true,
      // Public subnets: the load balancer itself must be reachable.
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });

    const listener = this.loadBalancer.addListener('HttpListener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      // Opens the security group to 0.0.0.0/0 on port 80. The endpoints behind
      // it are the public read path, which requires no authentication by design.
      open: true,
    });

    listener.addTargets('ReportsTarget', {
      targetGroupName: config.resourceName('reports-tg'),
      targets: [new targets.LambdaTarget(albReportsFn)],
      /**
       * ALB health checks a Lambda target by invoking it, so `/health` is a real
       * request rather than a TCP probe. The interval is deliberately long: each
       * check is a billable invocation, and a slow check costs nothing in
       * usefulness here because the target cannot be unhealthy in the way an
       * instance can.
       */
      healthCheck: {
        enabled: true,
        path: '/health',
        interval: Duration.minutes(5),
        timeout: Duration.seconds(10),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 5,
      },
    });

    new CfnOutput(this, 'LoadBalancerUrl', {
      value: `http://${this.loadBalancer.loadBalancerDnsName}`,
      description: 'ALB ingress (HTTP only — ACM is out of scope for this project)',
    });
    new CfnOutput(this, 'TeardownCommand', {
      value: `npx cdk destroy ${id}`,
      description: 'This stack bills hourly while it exists. Destroy it after the demo.',
    });
  }
}
