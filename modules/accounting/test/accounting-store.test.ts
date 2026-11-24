import { InMemoryAccountingStore } from '../src/index.ts';
import { accountingStoreSuite } from '../test-suites/accounting-store.ts';

accountingStoreSuite('InMemoryAccountingStore', async () => ({ store: new InMemoryAccountingStore() }));
