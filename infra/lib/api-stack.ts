import { Stack } from 'aws-cdk-lib';
import type * as cognito from 'aws-cdk-lib/aws-cognito';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import type * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';
import type { DerfStackProps } from './config';

export interface ApiStackProps extends DerfStackProps {
  /** Backs the JWT authorizer that gates every write endpoint. */
  readonly userPool: cognito.IUserPool;
  /** The browser client the frontend authenticates against. */
  readonly userPoolClient: cognito.IUserPoolClient;
  /** Reports are read directly here; writes go via the pipeline. */
  readonly reportsTable: dynamodb.ITable;
  /** Needed to mint pre-signed upload URLs for report photos. */
  readonly reportImagesBucket: s3.IBucket;
}

/**
 * API Gateway plus the request-handling Lambdas.
 *
 * Grant permissions with the `grant*` helpers on the passed-in table and bucket
 * (`reportsTable.grantReadData(fn)`), never a hand-written policy — that is what
 * keeps the M7 IAM review short.
 *
 * TODO(M3): HTTP API with a Cognito JWT authorizer, `GET /health` (open) and
 * `GET /me` (authorised) to prove the auth path, then stubbed `POST /reports`
 * and `GET /reports?bbox=...` so the frontend has a real contract to build on.
 *
 * Do not put these Lambdas in a VPC. They only talk to AWS APIs, and a VPC would
 * pull in a NAT Gateway at ~US$32/month — the entire project budget.
 */
export class ApiStack extends Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);
  }
}
