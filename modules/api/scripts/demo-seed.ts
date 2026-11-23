/**
 * Fills a new demo installation with test data (ADR 0041): months of
 * customers, dogs, policies, claims, invoices and payments, made through the
 * API day by day. Runs against the databases in the environment, as
 * server.ts does, and stops if the installation already has products.
 *
 * Usage: npm run demo:seed [-- --months 6 --seed 1 --per-day 0.55]
 * Needs the same configuration as server.ts (databases, keys, documents and
 * Gotenberg), and PETVOLD_FAKE_BANK_SECRET. With DEMO_WEBHOOK_URL the demo
 * service is subscribed to every event first.
 */
import { compose, databasesFromEnv, documentsFromEnv, fakeBankFromEnv, newPayeeHoldDaysFromEnv, webhooksFromEnv } from '../src/composition.ts';
import { DemoClock, demoIds, runDemo } from '../src/demo-data.ts';
import { marketDate, addDays } from '@petvold/common';

const arg = (name: string, fallback: number) => {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? Number(process.argv[i + 1]) : fallback;
  if (!Number.isFinite(v) || v < 0) throw new Error(`--${name} must be a number`);
  return v;
};
const months = arg('months', 6);
const seed = arg('seed', 1);
const perDay = arg('per-day', 0.55);

const fake = fakeBankFromEnv(process.env);
if (!fake) throw new Error('PETVOLD_FAKE_BANK_SECRET is missing: the demo pays its invoices through the fake bank');
const to = marketDate('SE', new Date().toISOString());
const from = addDays(to, -Math.round(months * 30.44));
const clock = new DemoClock(`${from}T06:00:00.000Z`);
const inst = await compose({
  databases: databasesFromEnv(process.env),
  engineVersion: process.env.PETVOLD_VERSION ?? 'demo',
  clock,
  ids: demoIds(seed),
  log: () => {},
  documents: documentsFromEnv(process.env),
  webhooks: webhooksFromEnv(process.env),
  payments: { fake, newPayeeHoldDays: newPayeeHoldDaysFromEnv(process.env) },
});
try {
  await inst.ping();
  if ((await inst.stores.products.productNames()).length > 0) {
    console.error('The installation already has products: the demo data goes only into a new one. Run deploy/demo/reset.sh, or npm run dev:reset locally.');
    process.exitCode = 1;
  } else {
    const t = Date.now();
    console.log(`Demo data from ${from} to ${to}, seed ${seed}, ${perDay} new customers a day`);
    const sum = await runDemo(inst, clock, { from, to, seed, customersPerDay: perDay, bankSecret: fake.secret, petvoldDocuments: Boolean(process.env.PETVOLD_GOTENBERG_URL), ...(process.env.DEMO_WEBHOOK_URL ? { webhookUrl: process.env.DEMO_WEBHOOK_URL } : {}), log: console.log });
    console.log(sum);
    const dead = inst.relay.deadLetters();
    console.log(`Done in ${Math.round((Date.now() - t) / 1000)} s, ${dead.length} dead letter(s) in the relay`);
    if (dead.length) process.exitCode = 1;
  }
} finally {
  await inst.close();
}
