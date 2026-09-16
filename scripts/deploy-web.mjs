#!/usr/bin/env node
/**
 * Builds the frontend and publishes it to S3 + CloudFront.
 *
 * Deliberately a plain script rather than CDK's BucketDeployment construct,
 * which would provision a custom-resource Lambda and IAM role to do the same
 * job. This is also exactly what the M8 CI pipeline will run, so the deploy path
 * is identical by hand and in automation.
 *
 * Usage:  npm run deploy:web
 */
import { execFileSync } from 'node:child_process';

const STACK_WEB = 'Derf-dev-Web';
const REGION = process.env.AWS_REGION ?? 'us-east-1';

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    shell: process.platform === 'win32',
    ...options,
  });
}

/** Reads one CloudFormation output, so nothing here hardcodes a resource name. */
function stackOutput(stackName, outputKey) {
  const value = run(
    'aws',
    [
      'cloudformation',
      'describe-stacks',
      '--stack-name',
      stackName,
      '--region',
      REGION,
      '--query',
      `Stacks[0].Outputs[?OutputKey=='${outputKey}'].OutputValue`,
      '--output',
      'text',
    ],
    { capture: true },
  ).trim();

  if (!value || value === 'None') {
    throw new Error(
      `Could not read ${outputKey} from ${stackName}. Has the stack been deployed?`,
    );
  }
  return value;
}

console.log('Reading stack outputs…');
const bucket = stackOutput(STACK_WEB, 'FrontendBucketName');
const distributionId = stackOutput(STACK_WEB, 'DistributionId');
console.log(`  bucket:       ${bucket}`);
console.log(`  distribution: ${distributionId}`);

console.log('\nBuilding frontend…');
run('npm', ['run', 'build', '-w', '@derf/web']);

console.log('\nUploading fingerprinted assets (long cache)…');
// Hashed filenames never change content, so they can be cached indefinitely.
run('aws', [
  's3',
  'sync',
  'web/dist',
  `s3://${bucket}`,
  '--region',
  REGION,
  '--delete',
  '--exclude',
  'index.html',
  '--cache-control',
  'public,max-age=31536000,immutable',
]);

console.log('\nUploading index.html (no cache)…');
// index.html is the one file whose name is stable, so it must never be cached —
// otherwise a deploy ships new assets that nothing references.
run('aws', [
  's3',
  'cp',
  'web/dist/index.html',
  `s3://${bucket}/index.html`,
  '--region',
  REGION,
  '--cache-control',
  'no-cache,no-store,must-revalidate',
]);

console.log('\nInvalidating CloudFront…');
run('aws', [
  'cloudfront',
  'create-invalidation',
  '--distribution-id',
  distributionId,
  '--paths',
  '/index.html',
  '--region',
  REGION,
]);

console.log('\nDone.');
