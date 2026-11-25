/** An approved erasure takes the party's data in other modules with it (ADR 0028, 0038 point 9, 0040 punkt 11). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compose } from '../src/composition.ts';

const pdf = new TextEncoder().encode('%PDF-1.7 test');

test("an approved erasure deletes the party's documents and payee details through the composition's hooks", async () => {
  const clock = { now: () => '2026-11-20T10:00:00.000Z' };
  const inst = await compose({ databases: {}, engineVersion: 'test', clock, payments: { newPayeeHoldDays: 3 } });
  const { documents, payments } = inst.deps;
  const parties = inst.deps.parties!;
  const p = await parties.register({ kind: 'person', market: 'SE', givenName: 'Test', familyName: 'Person', identifiers: [] }, 'reg@example.test');
  const doc = await documents!.upload({ bytes: pdf, mediaType: 'application/pdf', filename: 'x.pdf', owner: { policyId: 'pol_x' }, partyIds: [p.id], market: 'SE' }, 'h@example.test');
  await payments!.addPayeeAccount({ partyId: p.id }, { market: 'SE', method: 'se-bank', details: { clearing: '8327', account: '9412345678' } }, 'kundservice@example.test');

  const r = await parties.requestErasure(p.id, { basis: 'subject-request', reason: 'Asked by phone' }, 'officer-a');
  await parties.approveErasure(r.id, {}, 'officer-b');

  assert.equal((await parties.get(p.id)).anonymized, true);
  assert.ok((await documents!.get(doc.id)).erasedAt, 'the file is erased, the record kept');
  assert.deepEqual(await payments!.payeeAccounts({ partyId: p.id }), [], 'the account number is erased');
});
