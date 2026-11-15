/** Authentication with JWT (ADR 0016, granskningen A2). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { authenticatorFromEnv, jwtAuthenticator, principalFromPayload } from '../src/auth.ts';

const ISSUER = 'https://login.example.test/';
const AUDIENCE = 'petvold';

async function setup() {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256' };
  const auth = await jwtAuthenticator({ issuer: ISSUER, audience: AUDIENCE }, createLocalJWKSet({ keys: [jwk] }));
  const sign = (claims: Record<string, unknown>, o: { issuer?: string; audience?: string; exp?: string | number } = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
      .setIssuer(o.issuer ?? ISSUER)
      .setAudience(o.audience ?? AUDIENCE)
      .setSubject('handlaggare@example.test')
      .setIssuedAt()
      .setExpirationTime(o.exp ?? '5m')
      .sign(privateKey);
  return { auth, sign };
}

test('a valid token gives the principal with roles, markets and bindings', async () => {
  const { auth, sign } = await setup();
  const p = await auth.authenticate(await sign({ roles: ['handler'], petvold_markets: ['SE', 'NO'] }));
  assert.deepEqual(p, { subject: 'handlaggare@example.test', roles: ['handler'], markets: ['SE', 'NO'] });
  const clinic = await auth.authenticate(await sign({ roles: 'clinic', petvold_markets: 'SE', petvold_clinic_id: 'clinic_001' }));
  assert.deepEqual(clinic, { subject: 'handlaggare@example.test', roles: ['clinic'], markets: ['SE'], clinicId: 'clinic_001' });
  assert.equal((await auth.authenticate(await sign({ roles: ['handler'], petvold_markets: '*' })))?.markets, '*');
});

test('a token from another issuer, for another audience, expired, or not signed by the keys gives no principal', async () => {
  const { auth, sign } = await setup();
  assert.equal(await auth.authenticate(await sign({ roles: ['handler'] }, { issuer: 'https://evil.example.test/' })), null);
  assert.equal(await auth.authenticate(await sign({ roles: ['handler'] }, { audience: 'other' })), null);
  assert.equal(await auth.authenticate(await sign({ roles: ['handler'] }, { exp: Math.floor(Date.now() / 1000) - 120 })), null);
  const other = await setup();
  assert.equal(await auth.authenticate(await other.sign({ roles: ['handler'] })), null);
  assert.equal(await auth.authenticate('not-a-jwt'), null);
  assert.equal(await auth.authenticate(undefined), null);
});

test('only asymmetric algorithms, and the configuration is required', async () => {
  await assert.rejects(jwtAuthenticator({ issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256'] }), /asymmetric/);
  await assert.rejects(authenticatorFromEnv({}), /PETVOLD_AUTH_ISSUER/);
  assert.equal(principalFromPayload({ roles: ['handler'] }), null); // no subject
  assert.deepEqual(principalFromPayload({ sub: 's', groups: ['a'], m: 'SE' }, { roles: 'groups', markets: 'm' }), { subject: 's', roles: ['a'], markets: ['SE'] });
});
