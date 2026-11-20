import { InMemoryDocumentStore } from '../src/index.ts';
import { documentStoreSuite } from '../test-suites/document-store.ts';

documentStoreSuite('InMemoryDocumentStore', async () => ({ store: new InMemoryDocumentStore() }));
