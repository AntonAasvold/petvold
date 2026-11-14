import { InMemoryRuleSetStore } from '../src/index.ts';
import { ruleSetStoreSuite } from '../test-suites/rule-set-store.ts';

ruleSetStoreSuite('InMemoryRuleSetStore', async () => ({ store: new InMemoryRuleSetStore() }));
