/**
 * Properties of unpaid premium (ADR 0040, punkt 7; FAL 5 kap. 2 §): whatever
 * days the run happens to run on, the customer is never reminded or given
 * notice too early, and a payment before the cancellation takes effect always
 * voids it, and only then.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { addDays } from '@petvold/common';
import { cancellationsToVoid, nextDunningAction, type DunningStep } from '../src/index.ts';

const RULES = { reminderAfterDays: 7, cancellationNoticeAfterDays: 21 };
const NOTICE_DAYS = 14; // the policy module's unpaid-premium notice period in Sweden
const DUE = '2027-01-31';

const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

test('never reminded or noticed too early, each at most once, and the gap after a late reminder is kept', () => {
  fc.assert(
    fc.property(fc.uniqueArray(fc.integer({ min: -10, max: 80 }), { minLength: 1, maxLength: 40 }), (offsets) => {
      const steps: DunningStep[] = [];
      for (const off of [...offsets].sort((a, b) => a - b)) {
        const on = addDays(DUE, off);
        const action = nextDunningAction({ dueDate: DUE, open: 100 }, steps, on, RULES);
        if (action === 'remind') steps.push({ step: 'reminded', on, at: `${on}T05:00:00.000Z`, by: 'scheduler' });
        if (action === 'notice') steps.push({ step: 'cancellation-noticed', on, at: `${on}T05:00:00.000Z`, by: 'scheduler', cancellations: [], skipped: [] });
      }
      const reminded = steps.filter((s) => s.step === 'reminded');
      const noticed = steps.filter((s) => s.step === 'cancellation-noticed');
      assert.ok(reminded.length <= 1 && noticed.length <= 1);
      if (reminded[0]) assert.ok(days(DUE, reminded[0].on) >= RULES.reminderAfterDays);
      if (noticed[0]) {
        assert.ok(reminded[0], 'never notice without a reminder');
        assert.ok(days(DUE, noticed[0].on) >= RULES.cancellationNoticeAfterDays);
        assert.ok(days(reminded[0]!.on, noticed[0].on) >= RULES.cancellationNoticeAfterDays - RULES.reminderAfterDays);
      }
    }),
    { numRuns: 300 },
  );
});

test('a paid invoice is never reminded or noticed', () => {
  fc.assert(
    fc.property(fc.integer({ min: -10, max: 80 }), (off) => {
      assert.equal(nextDunningAction({ dueDate: DUE, open: 0 }, [], addDays(DUE, off), RULES), null);
    }),
  );
});

test('a payment voids the cancellation exactly when it comes before the cancellation takes effect, and once', () => {
  fc.assert(
    fc.property(fc.integer({ min: 21, max: 60 }), fc.integer({ min: 0, max: 40 }), (noticeOff, paidAfterNotice) => {
      const on = addDays(DUE, noticeOff);
      const effectiveDate = addDays(on, NOTICE_DAYS);
      const steps: DunningStep[] = [
        { step: 'reminded', on: addDays(DUE, 7), at: 'x', by: 's' },
        { step: 'cancellation-noticed', on, at: 'x', by: 's', cancellations: [{ policyId: 'pol_1', transactionId: 'ptx_1', effectiveDate }], skipped: [] },
      ];
      const paidOn = addDays(on, paidAfterNotice);
      const toVoid = cancellationsToVoid(steps, paidOn);
      assert.equal(toVoid.length === 1, paidOn < effectiveDate, `paid ${paidOn}, effective ${effectiveDate}`);
      if (toVoid.length) {
        steps.push({ step: 'cancellation-voided', on: paidOn, at: 'x', by: 'billing', policyId: 'pol_1', transactionId: 'ptx_1' });
        assert.deepEqual(cancellationsToVoid(steps, paidOn), [], 'once');
      }
    }),
    { numRuns: 300 },
  );
});
