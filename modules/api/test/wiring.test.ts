/** The adapters between modules (ADR 0001). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ClaimsService } from '@petvold/claims-core';
import type { PolicyService } from '@petvold/policies';
import { claimsActivity } from '../src/wiring.ts';

test('claims activity: only claims treated while the party held the policy, ongoing while one is open', async () => {
  const periods = [
    { policyId: 'pol_1', from: '2020-01-01', to: '2021-01-01' },
    { policyId: 'pol_2', from: '2022-06-01', to: '2023-06-01' },
  ];
  const asked: string[] = [];
  let open = false;
  const policies = { holderPeriods: async () => periods } as unknown as PolicyService;
  const claims = {
    claimActivity: async (policyId: string, from: string, to: string) => {
      asked.push(`${policyId} ${from} ${to}`);
      if (policyId === 'pol_2') return { open, lastAt: '2023-08-01T10:00:00.000Z' };
      return { open: false, lastAt: '2020-05-01T10:00:00.000Z' };
    },
  } as unknown as ClaimsService;
  const source = claimsActivity(policies, claims);
  assert.equal(source.name, 'claims');
  assert.deepEqual(await source.activityOf('pty_anna'), { lastDate: '2023-08-01' });
  assert.deepEqual(asked, ['pol_1 2020-01-01 2021-01-01', 'pol_2 2022-06-01 2023-06-01']);
  open = true;
  assert.deepEqual(await source.activityOf('pty_anna'), { ongoing: true });
  const none = claimsActivity({ holderPeriods: async () => [] } as unknown as PolicyService, claims);
  assert.equal(await none.activityOf('pty_bo'), null);
});
