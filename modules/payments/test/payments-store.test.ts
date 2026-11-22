import { InMemoryPaymentsStore } from '../src/index.ts';
import { paymentsStoreSuite } from '../test-suites/payments-store.ts';

paymentsStoreSuite('InMemoryPaymentsStore', async () => ({ store: new InMemoryPaymentsStore() }));
