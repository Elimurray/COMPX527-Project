import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserAttribute,
  CognitoUserPool,
  type CognitoUserSession,
} from 'amazon-cognito-identity-js';
import { config } from './config';

/**
 * Cognito authentication, using SRP.
 *
 * The user pool client is configured for SRP only — the password is never sent
 * to the server, and no plaintext-password flow is enabled even as a fallback.
 * This library performs that exchange in the browser.
 */

const pool = new CognitoUserPool({
  UserPoolId: config.userPoolId,
  ClientId: config.userPoolClientId,
});

export interface AuthUser {
  email: string;
  userId: string;
}

function userFor(email: string): CognitoUser {
  return new CognitoUser({ Username: email, Pool: pool });
}

/** Creates an account. Cognito emails a six-digit confirmation code. */
export function signUp(email: string, password: string): Promise<void> {
  return new Promise((resolve, reject) => {
    pool.signUp(
      email,
      password,
      [new CognitoUserAttribute({ Name: 'email', Value: email })],
      [],
      (err) => (err ? reject(err) : resolve()),
    );
  });
}

/** Confirms a new account with the emailed code. */
export function confirmSignUp(email: string, code: string): Promise<void> {
  return new Promise((resolve, reject) => {
    userFor(email).confirmRegistration(code, true, (err) =>
      err ? reject(err) : resolve(),
    );
  });
}

export function signIn(email: string, password: string): Promise<AuthUser> {
  return new Promise((resolve, reject) => {
    const user = userFor(email);
    user.authenticateUser(
      new AuthenticationDetails({ Username: email, Password: password }),
      {
        onSuccess: (session) => {
          resolve({
            email,
            userId: session.getIdToken().payload.sub as string,
          });
        },
        onFailure: reject,
      },
    );
  });
}

export function signOut(): void {
  pool.getCurrentUser()?.signOut();
}

/** The signed-in user, if a session survives in browser storage. */
export function currentUser(): Promise<AuthUser | null> {
  return new Promise((resolve) => {
    const user = pool.getCurrentUser();
    if (!user) {
      resolve(null);
      return;
    }
    user.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session?.isValid()) {
        resolve(null);
        return;
      }
      resolve({
        email: (session.getIdToken().payload.email as string) ?? '',
        userId: session.getIdToken().payload.sub as string,
      });
    });
  });
}

/**
 * A valid access token for the API, refreshed if needed.
 *
 * The API Gateway authorizer validates the **access** token, not the id token —
 * sending the wrong one is the usual cause of an unexplained 401.
 */
export function accessToken(): Promise<string | null> {
  return new Promise((resolve) => {
    const user = pool.getCurrentUser();
    if (!user) {
      resolve(null);
      return;
    }
    user.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session?.isValid()) {
        resolve(null);
        return;
      }
      resolve(session.getAccessToken().getJwtToken());
    });
  });
}
