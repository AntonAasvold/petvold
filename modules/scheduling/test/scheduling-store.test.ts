import { InMemorySchedulingStore } from '../src/index.ts';
import { schedulingStoreSuite } from '../test-suites/scheduling-store.ts';

schedulingStoreSuite('InMemorySchedulingStore', async () => ({ store: new InMemorySchedulingStore() }));
