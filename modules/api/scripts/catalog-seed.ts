/**
 * Adds the installation's rule series, reference data and products that an
 * existing installation lacks, e.g. the test products (docs/funktion/testprodukter.md)
 * in a demo that already has its data. Never changes or removes anything that
 * is there: a series or product version that exists is left as it is.
 *
 * Shows what is missing by default; adds it only with --apply. Products go
 * through review like any other, so a series that does not cover a product stops it.
 *
 * Usage: npm run catalog:seed [-- --apply]   (the databases as for server.ts)
 */
import { compose, databasesFromEnv, documentsFromEnv, webhooksFromEnv } from '../src/composition.ts';
import { seedInstallation } from '../src/seed.ts';
import ruleSetSeed from '../seed/rule-sets.json' with { type: 'json' };
import productSeed from '@petvold/catalog/seed/products.json' with { type: 'json' };

const apply = process.argv.includes('--apply');
const clock = { now: () => new Date().toISOString() };
const inst = await compose({ databases: databasesFromEnv(process.env), engineVersion: process.env.PETVOLD_VERSION ?? 'catalog-seed', clock, log: () => {}, documents: documentsFromEnv(process.env), webhooks: webhooksFromEnv(process.env) });
try {
  await inst.ping();
  const missing: string[] = [];
  for (const r of ruleSetSeed as { series: string }[]) if ((await inst.stores.rules.list(r.series)).length === 0) missing.push(`  + rule series ${r.series}`);
  for (const p of productSeed as { product: string; version: string }[]) if (!(await inst.stores.products.get(p.product, p.version))) missing.push(`  + product ${p.product}@${p.version}`);
  if (!missing.length) {
    console.log('OK – the installation has every seeded rule series and product');
  } else {
    console.log(`Missing:\n${missing.join('\n')}`);
    if (!apply) {
      console.log('Nothing added. Run again with --apply to add them.');
    } else {
      await seedInstallation(inst, clock);
      console.log('Added.');
    }
  }
} finally {
  await inst.close();
}
