/**
 * Fails if code contains Swedish characters (å, ä, ö).
 *
 * Code is written in English: identifiers, comments, error messages, log
 * output, test names, SQL, configuration and contracts. Documentation in
 * docs/ and Markdown files is written in Swedish and is not checked.
 *
 * This is a heuristic: Swedish text without å, ä or ö slips through, but
 * nearly every Swedish sentence contains at least one of them.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const CODE = /(\.(ts|js|mjs|sql|ya?ml|http|json|sh)|^\.env\.example)$/;

/** Files allowed to contain Swedish, and why. */
const ALLOWED: Record<string, string> = {
  'scripts/check-language.ts': 'names the characters it looks for',
  'modules/claims-api/src/messages.ts': 'Swedish message catalogue for users (sv)',
  'db/migrations/0001_claims.sql': 'migration already applied; never edited',
  'db/migrations/0002_claims_grants.sql': 'migration already applied; never edited',
  'db/migrations/0003_claims_line_order_and_journal_currency.sql': 'migration already applied; never edited',
};

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
  .split('\n')
  .filter((f) => CODE.test(f) && f !== 'package-lock.json' && !f.startsWith('docs/') && !(f in ALLOWED));

const hits: string[] = [];
for (const file of files) {
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (/[åäöÅÄÖ]/.test(line)) hits.push(`${file}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
}

if (hits.length) {
  console.error(`Swedish found in code (${hits.length} lines). Code is written in English, see CLAUDE.md.`);
  for (const h of hits) console.error(`  ${h}`);
  process.exit(1);
}
console.log(`OK – ${files.length} code files, no Swedish`);
