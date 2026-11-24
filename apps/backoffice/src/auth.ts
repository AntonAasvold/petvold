/**
 * Signing in (ADR 0035): OIDC with authorization code and PKCE against the
 * insurer's identity service, with the token only in memory. In development the
 * dev server's tokens are picked on a login page instead.
 */
import { InMemoryWebStorage, UserManager, WebStorageStateStore } from 'oidc-client-ts';

export interface Session {
  kind: 'dev' | 'oidc';
  /** The bearer token for the API, or null when signed out. */
  token(): Promise<string | null>;
  signIn(choice?: string): Promise<void>;
  /** Finishes a redirect from the identity service. */
  completeSignIn?(): Promise<void>;
  signOut(): Promise<void>;
}

/** The dev server's tokens (modules/api/src/dev-server.ts). */
export const DEV_TOKENS = [
  'dev-handler',
  'dev-all',
  'dev-all-2',
  'dev-approver',
  'dev-underwriter',
  'dev-seller',
  'dev-documents',
  'dev-integration',
  'dev-operations',
  'dev-operations-2',
  'dev-communications',
  'dev-admin',
  'dev-catalog',
  'dev-catalog-publisher',
  'dev-author',
  'dev-publisher',
  'dev-registrar',
  'dev-privacy',
  'dev-privacy-2',
  'dev-billing',
  'dev-billing-manager',
  'dev-accountant',
] as const;

export function devSession(): Session {
  let token: string | null = null;
  return {
    kind: 'dev',
    token: async () => token,
    signIn: async (choice) => {
      token = choice ?? null;
    },
    signOut: async () => {
      token = null;
    },
  };
}

export function oidcSession(o: { authority: string; clientId: string; scope?: string }): Session {
  const users = new UserManager({
    authority: o.authority,
    client_id: o.clientId,
    redirect_uri: `${location.origin}/callback`,
    post_logout_redirect_uri: location.origin,
    response_type: 'code',
    scope: o.scope ?? 'openid',
    // Tokens live in memory only; a reload signs in again through the identity service's session.
    userStore: new WebStorageStateStore({ store: new InMemoryWebStorage() }),
    automaticSilentRenew: true,
  });
  return {
    kind: 'oidc',
    token: async () => {
      const u = await users.getUser();
      return u && !u.expired ? u.access_token : null;
    },
    signIn: async () => users.signinRedirect({ state: location.pathname }),
    completeSignIn: async () => {
      const u = await users.signinRedirectCallback();
      history.replaceState(null, '', typeof u.state === 'string' ? u.state : '/');
    },
    signOut: async () => {
      await users.removeUser();
      await users.signoutRedirect().catch(() => undefined);
    },
  };
}

/** The session the build is configured for: OIDC when VITE_OIDC_ISSUER is set, else dev tokens. */
export function sessionFromEnv(env: Record<string, string | undefined>): Session {
  return env.VITE_OIDC_ISSUER ? oidcSession({ authority: env.VITE_OIDC_ISSUER, clientId: env.VITE_OIDC_CLIENT_ID ?? 'petvold-backoffice', scope: env.VITE_OIDC_SCOPE }) : devSession();
}
