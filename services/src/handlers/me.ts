import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from 'aws-lambda';
import { logger } from '../lib/logger';
import { fail, ok } from '../lib/response';

/**
 * GET /me — requires a valid Cognito access token.
 *
 * Exists to prove the auth boundary works before any real logic depends on it:
 * unauthenticated requests must never reach this code at all, because API
 * Gateway rejects them at the authorizer with a 401.
 */
export const handler: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
  const requestId = event.requestContext.requestId;
  const claims = event.requestContext.authorizer?.jwt?.claims;

  // Defensive: reaching here without claims would mean the route was wired
  // without the authorizer, which is a deployment bug rather than a user error.
  if (!claims) {
    logger.error('authorised route reached with no JWT claims', { requestId });
    return fail(500, 'MISSING_CLAIMS', 'Authoriser did not supply claims', requestId);
  }

  logger.info('me', { requestId, userId: String(claims.sub) });

  return ok({
    userId: claims.sub,
    email: claims.email ?? null,
    tokenUse: claims.token_use ?? null,
  });
};
