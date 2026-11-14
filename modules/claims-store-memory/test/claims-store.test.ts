import { claimsStoreSuite } from '@petvold/claims-core/test-suites/claims-store';
import { InMemoryClaimsStore } from '../src/index.ts';

claimsStoreSuite('InMemoryClaimsStore', async () => ({ store: new InMemoryClaimsStore() }));
