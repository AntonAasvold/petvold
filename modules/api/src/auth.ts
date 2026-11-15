/**
 * Authentication with JWT from the insurer's identity provider (ADR 0016,
 * granskningen A2). Petvold stores no users: the access token says who calls,
 * which roles they have and what they are bound to. The roles map to
 * permissions with the installation's role settings (ADR 0020).
 *
 * The token is verified against the provider's keys (JWKS), its issuer, its
 * audience, its expiry and an allowed algorithm (RFC 9068, RFC 8725). The keys
 * are fetched from jwksUrl, or from the issuer's OpenID configuration.
 */
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import type { Authenticator, Principal } from './app.ts';

export interface JwtConfig {
  issuer: string;
  audience: string;
  /** Omitted: from `${issuer}/.well-known/openid-configuration`. */
  jwksUrl?: string;
  /** Default RS256 and ES256. Never 'none' or a symmetric algorithm. */
  algorithms?: string[];
  /** Where the token keeps Petvold's attributes. Defaults: roles, petvold_markets, petvold_clinic_id, petvold_policy_ids. */
  claims?: { roles?: string; markets?: string; clinicId?: string; policyIds?: string };
  /** Seconds of clock difference allowed. Default 30. */
  clockToleranceSeconds?: number;
}

const ASYMMETRIC = /^(RS|PS|ES)(256|384|512)$|^EdDSA$/;

/** The principal from a verified token's payload. Pure. */
export function principalFromPayload(payload: JWTPayload, claims: JwtConfig['claims'] = {}): Principal | null {
  const list = (v: unknown): string[] | undefined => {
    if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v;
    if (typeof v === 'string' && v) return v.split(/[\s,]+/).filter(Boolean);
    return undefined;
  };
  if (typeof payload.sub !== 'string' || !payload.sub) return null;
  const roles = list(payload[claims.roles ?? 'roles']) ?? [];
  const marketsRaw = payload[claims.markets ?? 'petvold_markets'];
  const markets = marketsRaw === '*' ? '*' : list(marketsRaw);
  const clinicId = payload[claims.clinicId ?? 'petvold_clinic_id'];
  const policyIds = list(payload[claims.policyIds ?? 'petvold_policy_ids']);
  return {
    subject: payload.sub,
    roles,
    ...(markets ? { markets } : {}),
    ...(typeof clinicId === 'string' && clinicId ? { clinicId } : {}),
    ...(policyIds ? { policyIds } : {}),
  };
}

/** An Authenticator that verifies JWT access tokens. `keys` can be given in tests. */
export async function jwtAuthenticator(config: JwtConfig, keys?: JWTVerifyGetKey): Promise<Authenticator> {
  const algorithms = config.algorithms ?? ['RS256', 'ES256'];
  const weak = algorithms.filter((a) => !ASYMMETRIC.test(a));
  if (weak.length) throw new Error(`Only asymmetric JWT algorithms are allowed, not ${weak.join(', ')}`);
  let getKey = keys;
  if (!getKey) {
    let jwksUrl = config.jwksUrl;
    if (!jwksUrl) {
      const res = await fetch(`${config.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`);
      if (!res.ok) throw new Error(`Cannot read the OpenID configuration of ${config.issuer}: HTTP ${res.status}`);
      jwksUrl = ((await res.json()) as { jwks_uri?: string }).jwks_uri;
      if (!jwksUrl) throw new Error(`The OpenID configuration of ${config.issuer} has no jwks_uri`);
    }
    getKey = createRemoteJWKSet(new URL(jwksUrl));
  }
  return {
    async authenticate(token) {
      if (!token) return null;
      try {
        const { payload } = await jwtVerify(token, getKey!, {
          issuer: config.issuer,
          audience: config.audience,
          algorithms,
          clockTolerance: config.clockToleranceSeconds ?? 30,
          requiredClaims: ['exp', 'sub'],
        });
        return principalFromPayload(payload, config.claims);
      } catch {
        return null; // invalid, expired or for someone else: 401
      }
    },
  };
}

/**
 * Authentication from the environment:
 * PETVOLD_AUTH_ISSUER and PETVOLD_AUTH_AUDIENCE (required), PETVOLD_AUTH_JWKS_URL,
 * PETVOLD_AUTH_ALGORITHMS (comma-separated), and PETVOLD_AUTH_ROLES_CLAIM,
 * PETVOLD_AUTH_MARKETS_CLAIM, PETVOLD_AUTH_CLINIC_CLAIM and PETVOLD_AUTH_POLICIES_CLAIM.
 */
export async function authenticatorFromEnv(env: Record<string, string | undefined>): Promise<Authenticator> {
  if (!env.PETVOLD_AUTH_ISSUER || !env.PETVOLD_AUTH_AUDIENCE) {
    throw new Error('Authentication is required: set PETVOLD_AUTH_ISSUER and PETVOLD_AUTH_AUDIENCE (and PETVOLD_AUTH_JWKS_URL if the issuer has no OpenID configuration)');
  }
  const claims = {
    ...(env.PETVOLD_AUTH_ROLES_CLAIM ? { roles: env.PETVOLD_AUTH_ROLES_CLAIM } : {}),
    ...(env.PETVOLD_AUTH_MARKETS_CLAIM ? { markets: env.PETVOLD_AUTH_MARKETS_CLAIM } : {}),
    ...(env.PETVOLD_AUTH_CLINIC_CLAIM ? { clinicId: env.PETVOLD_AUTH_CLINIC_CLAIM } : {}),
    ...(env.PETVOLD_AUTH_POLICIES_CLAIM ? { policyIds: env.PETVOLD_AUTH_POLICIES_CLAIM } : {}),
  };
  return jwtAuthenticator({
    issuer: env.PETVOLD_AUTH_ISSUER,
    audience: env.PETVOLD_AUTH_AUDIENCE,
    ...(env.PETVOLD_AUTH_JWKS_URL ? { jwksUrl: env.PETVOLD_AUTH_JWKS_URL } : {}),
    ...(env.PETVOLD_AUTH_ALGORITHMS ? { algorithms: env.PETVOLD_AUTH_ALGORITHMS.split(',').map((a) => a.trim()) } : {}),
    claims,
  });
}
