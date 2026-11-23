/**
 * The jobs the scheduler runs (ADR 0037), registered by name. Each runs its
 * module's existing run for one market as the system. The summary kept in the
 * history has counts and ids only: it is kept for 400 days and shown to anyone
 * with jobs:read, so an application's answers or a party's dates stay out.
 *
 * The API's old run operations (POST /v1/renewal-runs and the others) run the
 * same jobs per market, keep the same history, and join the full results into
 * the response they always gave.
 */
import type { JobContext, JobDefinition, JobResult, Schedule } from '@petvold/scheduling';
import type { Application, PolicyService, Proposal, RenewalRunResult } from '@petvold/policies';
import type { RetentionRunResult, RetentionService } from '@petvold/parties';
import type { ClaimsService, InformationRunResult } from '@petvold/claims-core';
import type { BillingService, DunningRunResult, InvoicingRunResult } from '@petvold/billing';

export interface JobServices {
  policies: Pick<PolicyService, 'renewalRun' | 'expireApplications' | 'expireProposals'>;
  retention: Pick<RetentionService, 'run'>;
  claims: Pick<ClaimsService, 'informationRequestRun'>;
  billing: Pick<BillingService, 'invoicingRun' | 'dunningRun'>;
}

/** A job with its full result, for the API, and the summary the history keeps. */
export interface JobRunner<T> {
  name: string;
  schedule: Schedule;
  execute(ctx: JobContext): Promise<T>;
  summarize(full: T): JobResult;
  /** Joins one full result per market into the response the API gave before (ADR 0037). */
  join(fulls: T[], ctx: { dryRun: boolean; onDate: string }): unknown;
}

const sum = <T>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);

/** The jobs, by the names the history and the API use. */
export function jobRunners(s: JobServices) {
  const applicationExpiry: JobRunner<Application[]> = {
    name: 'policies.application-expiry',
    schedule: { kind: 'daily', at: '01:00' },
    execute: ({ market, by }) => s.policies.expireApplications(new Set([market]), by),
    summarize: (expired) => ({ expired: expired.length, applicationIds: expired.map((a) => a.id) }),
    join: (fulls) => ({ expired: fulls.flat() }),
  };
  const proposalExpiry: JobRunner<Proposal[]> = {
    name: 'policies.proposal-expiry',
    schedule: { kind: 'daily', at: '01:15' },
    execute: ({ market, by }) => s.policies.expireProposals(new Set([market]), by),
    summarize: (expired) => ({ expired: expired.length, proposalIds: expired.map((p) => p.id) }),
    join: (fulls) => ({ expired: fulls.flat() }),
  };
  const renewal: JobRunner<RenewalRunResult> = {
    name: 'policies.renewal',
    schedule: { kind: 'daily', at: '02:00' },
    execute: ({ market, by, dryRun }) => s.policies.renewalRun({ dryRun, markets: new Set([market]) }, by),
    summarize: (r) => ({
      checked: r.checked,
      renewed: r.renewed.length,
      cancelled: r.cancelled,
      notYet: r.notYet,
      needsDecision: r.needsDecision.map((n) => ({ policyId: n.policyId, issue: n.issue })),
      renewedPolicyIds: r.renewed.map((x) => x.policyId),
    }),
    join: (fulls, ctx): RenewalRunResult => ({
      onDate: fulls[0]?.onDate ?? ctx.onDate,
      dryRun: ctx.dryRun,
      checked: sum(fulls, (r) => r.checked),
      renewed: fulls.flatMap((r) => r.renewed),
      cancelled: sum(fulls, (r) => r.cancelled),
      notYet: sum(fulls, (r) => r.notYet),
      needsDecision: fulls.flatMap((r) => r.needsDecision),
    }),
  };
  const retention: JobRunner<RetentionRunResult> = {
    name: 'parties.retention',
    schedule: { kind: 'daily', at: '03:00' },
    execute: ({ market, by, dryRun }) => s.retention.run({ dryRun, markets: new Set([market]) }, by),
    summarize: (r) => ({
      settingsVersion: r.settingsVersion,
      checked: r.checked,
      due: r.due.length,
      ongoing: r.ongoing,
      withinRetention: r.withinRetention,
      pendingRequest: r.pendingRequest,
      requestIds: r.due.flatMap((d) => (d.requestId ? [d.requestId] : [])),
    }),
    join: (fulls, ctx): RetentionRunResult => ({
      onDate: fulls[0]?.onDate ?? ctx.onDate,
      dryRun: ctx.dryRun,
      settingsVersion: fulls[0]?.settingsVersion ?? 0,
      checked: sum(fulls, (r) => r.checked),
      due: fulls.flatMap((r) => r.due),
      ongoing: sum(fulls, (r) => r.ongoing),
      withinRetention: sum(fulls, (r) => r.withinRetention),
      pendingRequest: sum(fulls, (r) => r.pendingRequest),
      marketsWithoutRule: [...new Set(fulls.flatMap((r) => r.marketsWithoutRule))].sort(),
    }),
  };
  // Reminders and expiry of requests for information (ADR 0036). In the morning,
  // so that a reminder goes out on its day.
  const informationRequests: JobRunner<InformationRunResult> = {
    name: 'claims.information-requests',
    schedule: { kind: 'daily', at: '06:00' },
    execute: ({ market, onDate, by, dryRun }) => s.claims.informationRequestRun({ market, onDate, dryRun }, by),
    summarize: (r) => ({ reminded: r.reminded.length, expired: r.expired.length, remindedRequestIds: r.reminded, expiredRequestIds: r.expired }),
    join: (fulls) => fulls,
  };
  // Invoicing (ADR 0040): after the renewals, so a renewed term's first installment can go on the same day's invoice.
  const invoicing: JobRunner<InvoicingRunResult> = {
    name: 'billing.invoicing',
    schedule: { kind: 'daily', at: '04:00' },
    execute: ({ market, onDate, by, dryRun }) => s.billing.invoicingRun({ market, onDate, dryRun }, by),
    summarize: (r) => ({ checked: r.checked, invoiced: r.invoices.length, invoiceIds: r.invoices.flatMap((i) => (i.invoiceId ? [i.invoiceId] : [])) }),
    join: (fulls) => fulls,
  };
  // Unpaid premium (ADR 0040, punkt 7): after the invoicing, reminders and notice of cancellation.
  const dunning: JobRunner<DunningRunResult> = {
    name: 'billing.dunning',
    schedule: { kind: 'daily', at: '05:00' },
    execute: ({ market, onDate, by, dryRun }) => s.billing.dunningRun({ market, onDate, dryRun }, by),
    summarize: (r) => ({ checked: r.checked, reminded: r.reminded.length, noticed: r.noticed.length, invoiceIds: [...r.reminded, ...r.noticed.map((n) => n.invoiceId)] }),
    join: (fulls) => fulls,
  };
  return { applicationExpiry, proposalExpiry, renewal, retention, informationRequests, invoicing, dunning };
}

/** The jobs for the scheduler, with their default schedules in each market's time zone. */
export function defaultJobs(s: JobServices): JobDefinition[] {
  return Object.values(jobRunners(s)).map((r) => {
    const runner = r as JobRunner<unknown>;
    return { name: runner.name, schedule: runner.schedule, run: async (ctx: JobContext) => runner.summarize(await runner.execute(ctx)) };
  });
}
