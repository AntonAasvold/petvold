/**
 * After a restore from backup: runs every approved anonymization again, oldest
 * first, before the system opens (ADR 0028). Safe to run more than once.
 *
 * Usage: npm run erasures:reapply   (uses PARTIES_DATABASE_URL)
 */
import pg from 'pg';
import { reapplyErasures } from '../src/postgres.ts';

const url = process.env.PARTIES_DATABASE_URL;
if (!url) throw new Error('PARTIES_DATABASE_URL is missing');
const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  const parties = await reapplyErasures(pool);
  console.log(`OK – ${parties.length} anonymizations run again`);
} finally {
  await pool.end();
}
