import { InMemoryPartyStore } from '../src/index.ts';
import { partyStoreSuite } from '../test-suites/party-store.ts';

partyStoreSuite('InMemoryPartyStore', async () => ({ store: new InMemoryPartyStore() }));
