import { CfnOutput, Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import type { Construct } from 'constructs';
import type { DerfStackProps } from './config';

/**
 * Cognito user pool and app client — the identity boundary for the whole system.
 *
 * Separate from ApiStack because identities must survive API redeploys: replacing
 * a user pool deletes every registered account, and there is no undo.
 */
export class AuthStack extends Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props: DerfStackProps) {
    super(scope, id, props);
    const { config } = props;

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: config.resourceName('users'),

      // Community members sign themselves up — that is the entire premise of
      // crowdsourced reporting.
      selfSignUpEnabled: true,

      // Email as the sign-in identifier. No separate username to forget, and it
      // gives us a verified contact for the SNS notifications in M5.
      signInAliases: { email: true },
      signInCaseSensitive: false,
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
      },

      /**
       * Length over composition, following current NIST guidance: a 12-character
       * minimum with symbols optional resists guessing better than a short
       * password mangled to satisfy four character-class rules.
       */
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
        tempPasswordValidity: Duration.days(3),
      },

      /**
       * MFA optional, and TOTP only.
       *
       * SMS is deliberately disabled: every SMS costs money through SNS, and at a
       * NZ$60 ceiling a sign-up loop or a bot could burn the budget outright.
       * Optional rather than required because this is a tool people reach for
       * during an emergency — mandatory second factors are the wrong trade when
       * someone is trying to report that a shelter is full.
       */
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { sms: false, otp: true },

      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,

      /**
       * LITE pinned explicitly. Cognito's tiers (Lite / Essentials / Plus) are
       * priced per monthly active user, and new pools would otherwise default to
       * Essentials. Lite covers sign-up, sign-in and MFA, which is all this
       * project needs. Plus adds threat protection at a materially higher
       * per-user price — do not enable it without checking the budget.
       */
      featurePlan: cognito.FeaturePlan.LITE,

      // Cognito's built-in email sender is capped at 50 messages/day and cannot
      // be raised. Fine for development and the demo; moving to real usage would
      // mean wiring SES, which needs domain verification first.
      email: cognito.UserPoolEmail.withCognito(),

      removalPolicy: config.isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    this.userPoolClient = this.userPool.addClient('WebClient', {
      userPoolClientName: config.resourceName('web-client'),

      // Public browser client: it cannot keep a secret, so it is not given one.
      generateSecret: false,

      /**
       * SRP only. The password never crosses the wire, and USER_PASSWORD_AUTH is
       * left off so a plaintext-password flow is not available even by accident.
       */
      authFlows: {
        userSrp: true,
        userPassword: false,
        adminUserPassword: false,
        custom: false,
      },

      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),

      // Returns a generic failure whether or not the account exists, so the
      // sign-in form cannot be used to enumerate registered users.
      preventUserExistenceErrors: true,

      // No OAuth / hosted-UI config yet: callback URLs need the CloudFront
      // domain, which does not exist until M6. Revisit then if the frontend
      // wants the hosted UI rather than its own form.
    });

    new CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'Set as VITE_COGNITO_USER_POOL_ID in the repo-root .env',
    });
    new CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      description: 'Set as VITE_COGNITO_CLIENT_ID in the repo-root .env',
    });
    new CfnOutput(this, 'UserPoolArn', {
      value: this.userPool.userPoolArn,
      description: 'Consumed by the API Gateway JWT authorizer in M3',
    });
  }
}
