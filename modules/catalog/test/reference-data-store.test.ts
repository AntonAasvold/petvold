import { InMemoryReferenceDataStore } from '../src/index.ts';
import { referenceDataStoreSuite } from '../test-suites/reference-data-store.ts';

referenceDataStoreSuite('InMemoryReferenceDataStore', async () => ({ store: new InMemoryReferenceDataStore() }));
