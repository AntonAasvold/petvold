/**
 * The jobs the scheduler runs (ADR 0037), registered by name. Each runs its
 * module's existing run for one market as the system. The result keeps counts
 * and ids only: the history is kept for 400 days and shown to anyone with
 * jobs:read, so an application's answers or a party's dates stay out.
 */
import type { JobDefinition } from '@petvold/scheduling';
import type { PolicyService } from '@petvold/policies';
import type { RetentionService } from '@petvold/parties';

export interface JobServices {
  policies: Pick<PolicyService, 'renewalRun' | 'expireApplications' | 'expireProposals'>;
  retention: Pick<RetentionService, 'run'>;
}

/** The default schedules, in each market's time zone. Expiry first, then renewal, then retention. */
export function defaultJobs(s: JobServices): JobDefinition[] {
  return [
    {
      name: 'policies.application-expiry',
      schedule: { kind: 'daily', at: '01:00' },
      async run({ market, by }) {
        const expired = await s.policies.expireApplications(new Set([market]), by);
        return { expired: expired.length, applicationIds: expired.map((a) => a.id) };
      },
    },
    {
      name: 'policies.proposal-expiry',
      schedule: { kind: 'daily', at: '01:15' },
      async run({ market, by }) {
        const expired = await s.policies.expireProposals(new Set([market]), by);
        return { expired: expired.length, proposalIds: expired.map((p) => p.id) };
      },
    },
    {
      name: 'policies.renewal',
      schedule: { kind: 'daily', at: '02:00' },
      async run({ market, by, dryRun }) {
        const r = await s.policies.renewalRun({ dryRun, markets: new Set([market]) }, by);
        return {
          checked: r.checked,
          renewed: r.renewed.length,
          cancelled: r.cancelled,
          notYet: r.notYet,
          needsDecision: r.needsDecision.map((n) => ({ policyId: n.policyId, issue: n.issue })),
          renewedPolicyIds: r.renewed.map((x) => x.policyId),
        };
      },
    },
    {
      name: 'parties.retention',
      schedule: { kind: 'daily', at: '03:00' },
      async run({ market, by, dryRun }) {
        const r = await s.retention.run({ dryRun, markets: new Set([market]) }, by);
        return {
          settingsVersion: r.settingsVersion,
          checked: r.checked,
          due: r.due.length,
          ongoing: r.ongoing,
          withinRetention: r.withinRetention,
          pendingRequest: r.pendingRequest,
          requestIds: r.due.flatMap((d) => (d.requestId ? [d.requestId] : [])),
        };
      },
    },
  ];
}
