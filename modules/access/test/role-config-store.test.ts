import { InMemoryRoleConfigStore } from '../src/index.ts';
import { roleConfigStoreSuite } from '../test-suites/role-config-store.ts';

roleConfigStoreSuite('InMemoryRoleConfigStore', async () => ({ store: new InMemoryRoleConfigStore() }));
