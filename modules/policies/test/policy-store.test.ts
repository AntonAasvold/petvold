import { InMemoryPolicyStore } from '../src/index.ts';
import { policyStoreSuite } from '../test-suites/policy-store.ts';

policyStoreSuite('InMemoryPolicyStore', async () => ({ store: new InMemoryPolicyStore() }));
