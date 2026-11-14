/**
 * Writes the golden file for every scenario that does not have one yet.
 * Existing golden files are never overwritten: they are the frozen record of
 * what the engine decided (ADR 0018). Review new files in the pull request.
 */
import { writeFileSync } from 'node:fs';
import { CALCULATION_MODEL, assess } from '@petvold/claims-core';
import { loadScenarios, readGolden, type Golden } from '@petvold/claims-core/test-suites/scenarios';

let written = 0;
for (const s of loadScenarios()) {
  if (readGolden(s)) continue;
  const golden: Golden = { scenario: s.id, calculationModel: CALCULATION_MODEL, input: s.input, assessment: assess(s.input) };
  writeFileSync(s.goldenPath, `${JSON.stringify(golden, null, 2)}\n`);
  console.log(`Wrote ${s.goldenPath}`);
  written++;
}
console.log(written ? `${written} new golden file(s). Review them before committing.` : 'All scenarios have golden files.');
