/** Reference data through the API (ADR 0022). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClaimsService } from '@petvold/claims-core';
import { FixedClock, InMemoryClaimsStore, InMemoryPolicyPort, SequentialIds, StaticRulesPort, fixtures } from '@petvold/claims-store-memory';
import { createApp, InMemoryIdempotencyStore, validatorFor, type Principal } from '@petvold/api';

const tokens: Record<string, Principal> = {
  catalog: { subject: 'catalog@example.test', roles: ['catalog-manager'] },
  clinic: { subject: 'klinik-001', roles: ['clinic'], markets: ['SE'], clinicId: 'clinic_001' },
  admin: { subject: 'admin@example.test', roles: ['admin'] },
};

function setup() {
  const clock = new FixedClock('2026-11-15T10:00:00.000Z');
  const service = new ClaimsService({
    policies: new InMemoryPolicyPort([]),
    rules: new StaticRulesPort({}, fixtures.RULES_SE_DOG),
    store: new InMemoryClaimsStore(),
    clock,
    ids: new SequentialIds(),
  });
  const app = createApp({ service, clock, idempotency: new InMemoryIdempotencyStore(), auth: { authenticate: async (t) => (t ? (tokens[t] ?? null) : null) } });
  return (method: string, path: string, token: string, body?: unknown, lang?: string) =>
    app.request(path, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(lang ? { 'accept-language': lang } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
}

const item = validatorFor('ReferenceItem');
const valid = (x: unknown) => assert.ok(item(structuredClone(x)), JSON.stringify(item.errors));

test('a catalog manager creates species and breeds, and a clinic reads them in its language', async () => {
  const call = setup();
  const dog = await call('PUT', '/v1/reference-data/species/dog', 'catalog', { labels: { en: 'Dog', sv: 'Hund' } });
  assert.equal(dog.status, 201);
  valid(await dog.json());
  await call('PUT', '/v1/reference-data/species/cat', 'catalog', { labels: { en: 'Cat', sv: 'Katt' } });
  assert.equal((await call('PUT', '/v1/reference-data/breed/dog-beagle', 'catalog', { parent: 'dog', labels: { en: 'Beagle' } })).status, 201);
  await call('PUT', '/v1/reference-data/breed/cat-domestic', 'catalog', { parent: 'cat', labels: { en: 'Domestic cat' } });

  const res = await call('GET', '/v1/reference-data/species', 'clinic', undefined, 'sv-SE,sv;q=0.9');
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  body.items.forEach(valid);
  assert.deepEqual(body.items.map((i: any) => [i.code, i.label]), [['cat', 'Katt'], ['dog', 'Hund']]);

  const breeds = (await (await call('GET', '/v1/reference-data/breed?parent=dog', 'clinic')).json()) as any;
  assert.deepEqual(breeds.items.map((i: any) => [i.code, i.label]), [['dog-beagle', 'Beagle']]);
});

test('a change needs the current revision and a reason, and the history shows it', async () => {
  const call = setup();
  await call('PUT', '/v1/reference-data/sex/male', 'catalog', { labels: { en: 'Male' } });
  const change = { labels: { en: 'Male' }, active: false, basedOnRevision: 1, reason: 'Replaced by intact and neutered' };
  assert.equal((await call('PUT', '/v1/reference-data/sex/male', 'catalog', change)).status, 200);
  assert.equal((await call('PUT', '/v1/reference-data/sex/male', 'catalog', change)).status, 200); // a retry
  const stale = await call('PUT', '/v1/reference-data/sex/male', 'catalog', { labels: { en: 'M' }, basedOnRevision: 1, reason: 'x' });
  assert.equal(stale.status, 409);
  const active = (await (await call('GET', '/v1/reference-data/sex?active=true', 'clinic')).json()) as any;
  assert.deepEqual(active.items, []);
  const h = (await (await call('GET', '/v1/reference-data/sex/male/revisions', 'clinic')).json()) as any;
  assert.deepEqual(h.items.map((i: any) => [i.revision, i.active, i.reason ?? null]), [[1, true, null], [2, false, change.reason]]);
});

test('errors: permissions, unknown kinds and codes, invalid input', async () => {
  const call = setup();
  assert.equal((await call('PUT', '/v1/reference-data/species/dog', 'clinic', { labels: { en: 'Dog' } })).status, 403);
  assert.equal((await call('GET', '/v1/reference-data/species', 'admin')).status, 403);
  assert.equal((await call('GET', '/v1/reference-data/colour', 'catalog')).status, 404);
  assert.equal((await call('GET', '/v1/reference-data/species/dog', 'catalog')).status, 404);
  assert.equal((await call('GET', '/v1/reference-data/species/dog/revisions', 'catalog')).status, 404);
  assert.equal((await call('PUT', '/v1/reference-data/species/dog', 'catalog', { labels: {} })).status, 422);
  assert.equal((await call('PUT', '/v1/reference-data/species/dog', 'catalog', { labels: { en: 'Dog' }, colour: 'brown' })).status, 422);
  assert.equal((await call('PUT', '/v1/reference-data/breed/dog-pug', 'catalog', { labels: { en: 'Pug' } })).status, 422);
  assert.equal((await call('GET', '/v1/reference-data/species?active=yes', 'catalog')).status, 422);
});
