import type { App, Environment } from 'aws-cdk-lib';
import { STAGES, type Stage } from '@derf/shared';

export interface DerfConfig {
  /** Short project slug used to prefix every resource name. */
  readonly project: 'derf';
  readonly stage: Stage;
  readonly env: Environment;
  /** Prefixes a resource name so dev and prod never collide. */
  resourceName(logicalName: string): string;
}

function assertStage(value: string): Stage {
  if (!(STAGES as readonly string[]).includes(value)) {
    throw new Error(`Unknown stage "${value}". Expected one of: ${STAGES.join(', ')}`);
  }
  return value as Stage;
}

/**
 * Resolves deployment config from CDK context first, then environment.
 *
 *   npx cdk deploy --all -c stage=dev
 *
 * Region defaults to ap-southeast-2 (Sydney) — the agreed project region, chosen
 * for latency from New Zealand. Account is never hardcoded; it comes from whoever
 * is authenticated, so nobody can accidentally deploy into the wrong account.
 */
export function resolveConfig(app: App): DerfConfig {
  const stage = assertStage(
    app.node.tryGetContext('stage') ?? process.env.DERF_STAGE ?? 'dev',
  );

  const account = process.env.CDK_DEFAULT_ACCOUNT;
  const region =
    app.node.tryGetContext('region') ??
    process.env.CDK_DEFAULT_REGION ??
    process.env.AWS_REGION ??
    'ap-southeast-2';

  return {
    project: 'derf',
    stage,
    env: { account, region },
    resourceName: (logicalName: string) => `derf-${stage}-${logicalName}`,
  };
}
