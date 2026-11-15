import { InMemoryProductStore } from '../src/index.ts';
import { productStoreSuite } from '../test-suites/product-store.ts';

productStoreSuite('InMemoryProductStore', async () => ({ store: new InMemoryProductStore() }));
