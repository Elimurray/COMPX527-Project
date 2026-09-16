/**
 * Runtime configuration, injected at build time by Vite.
 *
 * None of these are secrets. A Cognito user pool id and public client id are
 * compiled into the bundle by design and are visible to anyone who opens the
 * site; security comes from the pool's configuration, not from hiding them.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy .env.example to .env at the repo root and fill it from the CDK stack outputs.`,
    );
  }
  return value;
}

export const config = {
  apiBaseUrl: required('VITE_API_BASE_URL', import.meta.env.VITE_API_BASE_URL),
  userPoolId: required(
    'VITE_COGNITO_USER_POOL_ID',
    import.meta.env.VITE_COGNITO_USER_POOL_ID,
  ),
  userPoolClientId: required(
    'VITE_COGNITO_CLIENT_ID',
    import.meta.env.VITE_COGNITO_CLIENT_ID,
  ),
  region: import.meta.env.VITE_AWS_REGION ?? 'us-east-1',
} as const;

/** Where the map opens before the browser offers a location. */
export const DEFAULT_VIEW = {
  lat: -36.8485,
  lon: 174.7633,
  zoom: 12,
} as const;
