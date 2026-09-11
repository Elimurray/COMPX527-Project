import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { SNSClient } from '@aws-sdk/client-sns';
import { SQSClient } from '@aws-sdk/client-sqs';

/**
 * SDK clients created once at module scope.
 *
 * Lambda reuses a warm execution environment across invocations, so a client
 * built here survives between requests and its connection pool stays warm.
 * Constructing them inside the handler would pay TLS setup on every call.
 */

export const sqs = new SQSClient({});
export const sns = new SNSClient({});

export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: {
    // A report with no note should not persist an empty attribute.
    removeUndefinedValues: true,
  },
});

/** Reads a required environment variable, failing loudly at cold start. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
