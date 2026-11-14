/**
 * Runs every scenario in scenarios/claims (layer 3): the readable
 * expectations, and an exact replay of the frozen golden file (ADR 0018).
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { assess, replay } from '@petvold/claims-core';
import { loadScenarios, readGolden } from '../test-suites/scenarios.ts';

const scenarios = loadScenarios();

test('there are scenarios', () => {
  assert.ok(scenarios.length >= 5, `found ${scenarios.length}`);
});

for (const s of scenarios) {
  describe(`scenario ${s.id}: ${s.name}`, () => {
    test('the assessment meets the expectations', () => {
      const a = assess(s.input);
      const e = s.expect;
      if (e.proposedOutcome) assert.equal(a.proposedOutcome, e.proposedOutcome, 'proposedOutcome');
      if (e.mode) assert.equal(a.mode, e.mode, 'mode');
      if (e.calculation === null) assert.equal(a.calculation, null, 'calculation');
      else if (e.calculation) {
        for (const [k, v] of Object.entries(e.calculation)) {
          assert.deepEqual((a.calculation as Record<string, unknown> | null)?.[k], v, `calculation.${k}`);
        }
      }
      for (const [code, status] of Object.entries(e.rules ?? {})) {
        const statuses = a.rules.filter((r) => r.code === code).map((r) => r.status);
        assert.ok(statuses.includes(status as never), `rule ${code}: expected ${status}, got [${statuses.join(', ')}]`);
      }
    });

    test('the golden file replays exactly', () => {
      const golden = readGolden(s);
      assert.ok(golden, `${s.goldenPath} is missing. Run npm run scenarios:golden and review the new file.`);
      assert.deepEqual(
        golden.input,
        s.input,
        'The scenario has changed since its golden file was written. A changed scenario is a new decision: ' +
          'give it a new file name, or delete the golden file deliberately and regenerate it.',
      );
      const r = replay(
        { decisionId: s.id, input: golden.input, calculationModel: golden.calculationModel, engineVersion: 'golden' },
        golden.assessment,
        'current',
      );
      assert.equal(
        r.status,
        'identical',
        `The code no longer reproduces ${s.id} with model ${golden.calculationModel}. ` +
          `A change that alters stored results must be a new calculation model (ADR 0018). Differences: ${JSON.stringify(r.differences)}`,
      );
    });
  });
}
