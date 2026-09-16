#!/usr/bin/env node
import { App, Tags } from 'aws-cdk-lib';
import { resolveConfig } from '../lib/config';
import { StorageStack } from '../lib/storage-stack';
import { AuthStack } from '../lib/auth-stack';
import { ApiStack } from '../lib/api-stack';
import { PipelineStack } from '../lib/pipeline-stack';
import { WebStack } from '../lib/web-stack';
import { AlbStack } from '../lib/alb-stack';

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

const pipeline = new PipelineStack(app, `Derf-${config.stage}-Pipeline`, {
  ...stackProps,
  description: 'SQS-backed report processing and SNS notifications',
  reportsTable: storage.reportsTable,
});

const api = new ApiStack(app, `Derf-${config.stage}-Api`, {
  ...stackProps,
  description: 'API Gateway and request-handling Lambdas',
  userPool: auth.userPool,
  userPoolClient: auth.userPoolClient,
  reportsTable: storage.reportsTable,
  reportImagesBucket: storage.reportImagesBucket,
  reportsQueue: pipeline.reportsQueue,
});

// Passing constructs above already implies most of these, but stating them
// keeps deploy order correct as the shells get filled in.
const web = new WebStack(app, `Derf-${config.stage}-Web`, {
  ...stackProps,
  description: 'CloudFront distribution and the frontend bucket it serves',
});

/**
 * The only stack that bills while idle (~US$16-22/month for the load balancer).
 * Separated so it can be destroyed on its own after the demo:
 *   npx cdk destroy Derf-dev-Alb
 */
const alb = new AlbStack(app, `Derf-${config.stage}-Alb`, {
  ...stackProps,
  description: 'Application Load Balancer ingress for the public read path',
  reportsTable: storage.reportsTable,
});

// Storage -> Pipeline -> Api. No cycle: the pipeline never calls the API.
pipeline.addStackDependency(storage);
api.addStackDependency(auth);
api.addStackDependency(pipeline);
// Storage must update first: it releases the frontend bucket name that WebStack
// then creates, so ordering prevents a name collision on this one deploy.
web.addStackDependency(storage);
alb.addStackDependency(storage);

app.synth();
