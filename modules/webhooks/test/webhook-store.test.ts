import { InMemoryWebhookStore } from '../src/index.ts';
import { webhookStoreSuite } from '../test-suites/webhook-store.ts';

webhookStoreSuite('InMemoryWebhookStore', async () => ({ store: new InMemoryWebhookStore() }));
