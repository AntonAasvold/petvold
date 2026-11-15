/** Fails if the contract and the implementation have drifted apart. Runs in CI. */
import { ClaimsService } from '@petvold/claims-core';
import { createApp, implementedOperations, contractOperations, operationPermissions, isOperationPermission } from '../src/index.ts';
import { InMemoryIdempotencyStore } from '../src/app.ts';

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
console.log(`OK – ${spec.size} operations in the contract, all implemented, all with a permission`);
