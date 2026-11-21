import { InMemoryBillingStore } from '../src/index.ts';
import { billingStoreSuite } from '../test-suites/billing-store.ts';

billingStoreSuite('InMemoryBillingStore', async () => ({ store: new InMemoryBillingStore() }));
