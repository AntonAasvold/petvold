/**
 * After a restore from backup: runs every approved anonymization again, oldest
 * first, before the system opens (ADR 0028). Then erases the payee details of
 * each of those parties in payments, which the restore may have brought back
 * (ADR 0040, punkt 11). Safe to run more than once.
 *
 * Usage: npm run erasures:reapply
 *   PARTIES_DATABASE_URL, and when set PAYMENTS_DATABASE_URL, and
 *   DOCUMENTS_DATABASE_URL with PETVOLD_DOCUMENTS_BUCKET for the documents'
 *   files (ADR 0038 point 9).
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { DocumentService } from '@petvold/documents';
import { PostgresDocumentStore } from '@petvold/documents/postgres';
import { S3BlobStore, s3ConfigFromEnv } from '@petvold/documents/s3';
import { reapplyErasures } from '@petvold/parties/postgres';
import { PostgresPaymentsStore } from '@petvold/payments/postgres';

const partiesUrl = process.env.PARTIES_DATABASE_URL;
if (!partiesUrl) throw new Error('PARTIES_DATABASE_URL is missing');
const parties = new pg.Pool({ connectionString: partiesUrl, max: 1 });
const paymentsUrl = process.env.PAYMENTS_DATABASE_URL;
const payments = paymentsUrl ? new pg.Pool({ connectionString: paymentsUrl, max: 1 }) : null;
const documentsUrl = process.env.DOCUMENTS_DATABASE_URL;
const s3 = s3ConfigFromEnv(process.env);
const documentsPool = documentsUrl && s3 ? new pg.Pool({ connectionString: documentsUrl, max: 1 }) : null;
const blobs = documentsPool && s3 ? new S3BlobStore(s3) : null;
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
  if (documentsPool && blobs) {
    // Only erasure is used here: the links' key and address do not matter.
    const documents = new DocumentService({ store: new PostgresDocumentStore(documentsPool), blobs, clock: { now: () => new Date().toISOString() }, ids: { next: (p) => `${p}_unused` }, signingKey: randomBytes(32), publicBaseUrl: 'http://localhost' });
    let n = 0;
    for (const id of new Set(ids)) n += await documents.erasePartyDocuments(id);
    console.log(`OK – documents' files deleted again; ${n} records marked erased now`);
  } else {
    console.log('DOCUMENTS_DATABASE_URL or PETVOLD_DOCUMENTS_BUCKET is not set: documents not checked');
  }
} finally {
  await parties.end();
  await payments?.end();
  await documentsPool?.end();
  blobs?.destroy();
}
