/**
 * After a restore from backup: runs every approved anonymization again, oldest
 * first, before the system opens (ADR 0028). Then erases the payee details of
 * each of those parties in payments, which the restore may have brought back
 * (ADR 0040, punkt 11). Safe to run more than once.
 *
 * Usage: npm run erasures:reapply   (uses PARTIES_DATABASE_URL, and PAYMENTS_DATABASE_URL when payments has its own database)
 */
import pg from 'pg';
import { reapplyErasures } from '@petvold/parties/postgres';
import { PostgresPaymentsStore } from '@petvold/payments/postgres';

const partiesUrl = process.env.PARTIES_DATABASE_URL;
if (!partiesUrl) throw new Error('PARTIES_DATABASE_URL is missing');
const parties = new pg.Pool({ connectionString: partiesUrl, max: 1 });
const paymentsUrl = process.env.PAYMENTS_DATABASE_URL;
const payments = paymentsUrl ? new pg.Pool({ connectionString: paymentsUrl, max: 1 }) : null;
try {
  const ids = await reapplyErasures(parties);
  console.log(`OK – ${ids.length} anonymizations run again`);
  if (payments) {
    const store = new PostgresPaymentsStore(payments);
    let n = 0;
    for (const id of new Set(ids)) n += await store.erasePayeeAccounts(id, new Date().toISOString());
    console.log(`OK – payee details erased again: ${n} accounts`);
  } else {
    console.log('PAYMENTS_DATABASE_URL is not set: payee details not checked');
  }
} finally {
  await parties.end();
  await payments?.end();
}
