/** Fails if the contract and the implementation have drifted apart. Runs in CI. */
import { ClaimsService } from '@petvold/claims-core';
import { createApp, implementedOperations, contractOperations, operationPermissions, isOperationPermission } from '../src/index.ts';
import { InMemoryIdempotencyStore } from '../src/app.ts';
import { openapi } from '../src/contract.ts';
import { conventionCheck, KNOWN_DEVIATIONS } from '../src/conventions.ts';
import { eventContractProblems } from '../src/events-contract.ts';
import { PUBLIC_EVENTS } from '@petvold/webhooks';

// Every operation must name one known permission, or signed-in (ADR 0016).
const withoutPermission = [...operationPermissions()].filter(([, p]) => !isOperationPermission(p)).map(([op, p]) => `${op} (${String(p)})`);
if (withoutPermission.length) {
  console.error('Operations without a valid x-permission:', withoutPermission);
  process.exit(1);
}

const app = createApp({
  service: {} as ClaimsService,
  clock: { now: () => '' },
  idempotency: new InMemoryIdempotencyStore(),
  auth: { authenticate: async () => null },
});
const spec = new Set(contractOperations());
const impl = new Set(implementedOperations(app));
const missing = [...spec].filter((o) => !impl.has(o));
const extra = [...impl].filter((o) => !spec.has(o));
if (missing.length || extra.length) {
  console.error('The contract and the implementation differ');
  if (missing.length) console.error('  In the contract but not implemented:', missing);
  if (extra.length) console.error('  Implemented but not in the contract:', extra);
  process.exit(1);
}
// The naming conventions (ADR 0034). Known breaks are listed until fixed.
const conventions = conventionCheck(openapi as never);
if (conventions.problems.length || conventions.fixed.length) {
  for (const p of conventions.problems) console.error(`  ${p.rule}: ${p.where} – ${p.message}`);
  if (conventions.problems.length) console.error('The contract breaks its conventions (docs/teknik/api-konventioner.md)');
  if (conventions.fixed.length) console.error('Fixed, remove from KNOWN_DEVIATIONS in conventions.ts:', conventions.fixed);
  process.exit(1);
}
console.log(`OK – ${spec.size} operations in the contract, all implemented, all with a permission`);
// The events (ADR 0033): asyncapi.yaml and the webhooks catalog agree.
const events = eventContractProblems();
if (events.length) {
  console.error('asyncapi.yaml and PUBLIC_EVENTS differ:');
  for (const p of events) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`OK – ${Object.keys(PUBLIC_EVENTS).length} events in asyncapi.yaml, as the webhooks catalog lets them through`);
console.log(`OK – the conventions hold${KNOWN_DEVIATIONS.length ? `, with ${KNOWN_DEVIATIONS.length} known breaks left` : ''}`);
