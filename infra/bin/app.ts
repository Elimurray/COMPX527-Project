#!/usr/bin/env node
import { App, Tags } from 'aws-cdk-lib';
import { resolveConfig } from '../lib/config';
import { StorageStack } from '../lib/storage-stack';
import { AuthStack } from '../lib/auth-stack';
import { ApiStack } from '../lib/api-stack';
import { PipelineStack } from '../lib/pipeline-stack';

const app = new App();
const config = resolveConfig(app);

// Tag everything. Cost allocation tags are how spend gets attributed when the
// budget alarm fires and we need to know what is actually costing money.
Tags.of(app).add('Project', config.project);
Tags.of(app).add('Stage', config.stage);
Tags.of(app).add('ManagedBy', 'cdk');
Tags.of(app).add('Course', 'COMPX527');

const stackProps = { env: config.env, config };

// Stacks are separated by lifecycle, so redeploying the API can never put the
// data stores at risk.

const storage = new StorageStack(app, `Derf-${config.stage}-Storage`, {
  ...stackProps,
  description: 'S3 buckets and the DynamoDB reports table',
});

const auth = new AuthStack(app, `Derf-${config.stage}-Auth`, {
  ...stackProps,
  description: 'Cognito user pool and app client',
});

const api = new ApiStack(app, `Derf-${config.stage}-Api`, {
  ...stackProps,
  description: 'API Gateway and request-handling Lambdas',
  userPool: auth.userPool,
  userPoolClient: auth.userPoolClient,
  reportsTable: storage.reportsTable,
  reportImagesBucket: storage.reportImagesBucket,
});

const pipeline = new PipelineStack(app, `Derf-${config.stage}-Pipeline`, {
  ...stackProps,
  description: 'SQS-backed report processing and SNS notifications',
  reportsTable: storage.reportsTable,
});

// Passing constructs above already implies most of these, but stating them
// keeps deploy order correct as the shells get filled in.
api.addStackDependency(auth);
pipeline.addStackDependency(storage);

app.synth();
