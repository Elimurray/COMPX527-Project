import type { App, Environment, StackProps } from 'aws-cdk-lib';
import { STAGES, type Stage } from '@derf/shared';

/**
 * The single AWS account this project deploys to.
 *
 * Hardcoded deliberately: the account sits inside the class's AWS Organization,
 * so a mis-set profile could otherwise deploy into someone else's account. A
 * mismatch fails loudly at synth time rather than quietly creating resources
 * somewhere unexpected.
 */
const PROJECT_ACCOUNT = '339254022271';

/**
 * Mandated region, carried over from the individual assignment. `cdk bootstrap`
 * has been run against this account/region pair — deploying elsewhere would need
 * a fresh bootstrap.
 */
const PROJECT_REGION = 'us-east-1';

export interface DerfConfig {
  /** Short project slug used to prefix every resource name. */
  readonly project: 'derf';
  readonly stage: Stage;
  readonly env: Required<Environment>;
  /** True for the production stage — gates retention and backup settings. */
  readonly isProd: boolean;
  /** Prefixes a resource name so dev and prod never collide. */
  resourceName(logicalName: string): string;
  /**
   * Globally-unique S3 bucket name. Bucket names share one global namespace, so
   * the account id is appended to keep them collision-free.
   */
  bucketName(logicalName: string): string;
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
 */
export function resolveConfig(app: App): DerfConfig {
  const stage = assertStage(
    app.node.tryGetContext('stage') ?? process.env.DERF_STAGE ?? 'dev',
  );

  // CDK_DEFAULT_ACCOUNT is whoever the CLI is authenticated as. If that is not
  // the project account, stop — do not deploy into the wrong account.
  const authenticatedAccount = process.env.CDK_DEFAULT_ACCOUNT;
  if (authenticatedAccount && authenticatedAccount !== PROJECT_ACCOUNT) {
    throw new Error(
      `Refusing to deploy: authenticated as account ${authenticatedAccount}, but this ` +
        `project targets ${PROJECT_ACCOUNT}. Check your AWS_PROFILE (see README).`,
    );
  }

  // Region is pinned rather than read from the environment: resources are
  // region-bound and the bootstrap only exists in PROJECT_REGION. Override
  // explicitly with `-c region=...` if you genuinely mean to.
  const region = app.node.tryGetContext('region') ?? PROJECT_REGION;

  return {
    project: 'derf',
    stage,
    env: { account: PROJECT_ACCOUNT, region },
    isProd: stage === 'prod',
    resourceName: (logicalName: string) => `derf-${stage}-${logicalName}`,
    bucketName: (logicalName: string) =>
      `derf-${stage}-${logicalName}-${PROJECT_ACCOUNT}`,
  };
}

/** Every stack in this app takes the resolved config. */
export interface DerfStackProps extends StackProps {
  readonly config: DerfConfig;
}
