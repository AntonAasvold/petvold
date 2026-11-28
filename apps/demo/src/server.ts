/**
 * Petvold Demo (docs/teknik/demotjanst.md): a process of its own beside
 * Petvold, never in production. It subscribes to every event through
 * Petvold's API, receives them at /webhooks/petvold, and shows them.
 *
 *   npm run dev -w @petvold/demo    # needs Petvold's dev server on :8787
 */
import { readFileSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { createApp, RECEIVER_PATH } from './app.ts';
import { configFromEnv } from './config.ts';
import { PostgresStore } from './postgres.ts';
import { MemoryStore, type Store } from './store.ts';
import { ensureSubscription } from './subscription.ts';
import type { SubscriptionStatus } from './views.ts';

const config = configFromEnv(process.env);
const store: Store = config.databaseUrl === 'memory' ? new MemoryStore() : new PostgresStore(config.databaseUrl);
const file = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
// Petvold's tokens and reference components (docs/teknik/designsystem.md), then the demo's own layout.
const css = [file('../../backoffice/src/styles/petvold-tokens.css'), file('../../../design/components.css'), file('./demo.css')].join('\n');

let secret: string | null = null;
let status: SubscriptionStatus = { state: 'waiting' };
const receiverUrl = `${config.publicUrl}${RECEIVER_PATH}`;

const app = createApp({ store, secret: () => secret, status: () => status, now: () => new Date(), basePath: config.basePath, backofficeUrl: config.backofficeUrl, css });
const server = serve({ fetch: app.fetch, port: config.port }, () => {
  console.log(`Petvold Demo on http://localhost:${config.port}${config.basePath}`);
  console.log(`  Receiver: ${receiverUrl}`);
  console.log(`  Petvold:  ${config.petvoldApiUrl}`);
  console.log(`  Storage:  ${config.databaseUrl === 'memory' ? 'memory' : 'Postgres'}`);
});

// The subscription, once Petvold answers; tried again every five seconds until then.
async function subscribe() {
  for (;;) {
    try {
      const r = await ensureSubscription({ baseUrl: config.petvoldApiUrl, token: config.integrationToken }, store, receiverUrl, () => new Date().toISOString());
      secret = r.subscription.secret;
      status = { state: 'ready', id: r.subscription.id, outcome: r.outcome };
      console.log(`Subscription ${r.subscription.id}: ${r.outcome}`);
      return;
    } catch (err) {
      status = { state: 'waiting', error: (err as Error).message };
      console.log(`Waiting for Petvold: ${(err as Error).message}`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}
void subscribe();

const stop = () => {
  server.close();
  void store.close().finally(() => process.exit(0));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
