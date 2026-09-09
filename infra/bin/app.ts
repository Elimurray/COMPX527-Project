#!/usr/bin/env node
import { App, Tags } from 'aws-cdk-lib';
import { resolveConfig } from '../lib/config';

const app = new App();
const config = resolveConfig(app);

// Tag everything. Cost allocation tags are how we attribute spend per stage when
// the M1 budget alarm fires and we need to know what is actually costing money.
Tags.of(app).add('Project', config.project);
Tags.of(app).add('Stage', config.stage);
Tags.of(app).add('ManagedBy', 'cdk');
Tags.of(app).add('Course', 'COMPX527');

// ---------------------------------------------------------------------------
// Stacks are added in M2. Keep them separated by lifecycle, so that redeploying
// the API never risks replacing the data stores:
//
//   M2  StorageStack   S3 buckets + DynamoDB reports table
//   M2  AuthStack      Cognito user pool + app client
//   M3  ApiStack       API Gateway + Lambda handlers
//   M4  IngestionStack EventBridge schedule + NOAA/FEMA ingestion Lambda
//   M5  PipelineStack  SQS + DLQ + processing Lambda + SNS topics
//   M6  WebStack       CloudFront distribution + frontend bucket (OAC)
// ---------------------------------------------------------------------------

app.synth();
