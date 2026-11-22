import { FakeProvider, signNotification } from '../src/index.ts';
import { fakeBody, SECRET } from './fake-bank.ts';
import { providerSuite } from '../test-suites/provider.ts';

const NOW = '2026-12-01T10:00:00.000Z';

providerSuite('FakeProvider', async () => ({
  provider: new FakeProvider({ secret: SECRET, markets: [{ market: 'SE', currency: 'SEK' }] }),
  now: NOW,
  notify: (p) => signNotification(SECRET, 'msg_1', Date.parse(NOW) / 1000, fakeBody(p)),
  stale: (p) => signNotification(SECRET, 'msg_1', Date.parse(NOW) / 1000 - 3600, fakeBody(p)),
}));
