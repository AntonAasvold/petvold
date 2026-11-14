/** Misslyckas om kontrakt och implementation har glidit isär. Körs i CI. */
import { ClaimsService } from '@petvold/claims-core';
import { createApp, implementedOperations, contractOperations } from '../src/index.ts';
import { InMemoryIdempotencyStore } from '../src/app.ts';

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
  console.error('Kontraktet och implementationen skiljer sig åt');
  if (missing.length) console.error('  I kontraktet men inte implementerat:', missing);
  if (extra.length) console.error('  Implementerat men inte i kontraktet:', extra);
  process.exit(1);
}
console.log(`OK – ${spec.size} operationer i kontraktet, alla implementerade`);
