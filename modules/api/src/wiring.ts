/**
 * Adapters that connect one module's port to another module's service, so the
 * modules themselves never depend on each other (ADR 0001). Used by createApp
 * and by the dev server.
 */
import { AnimalError, type AnimalService } from '@petvold/animals';
import type { AccountingSources } from '@petvold/accounting';
import { BillingError, type BillingService, type PolicyActions, type PolicySource as BillingPolicySource, type ProductSource as BillingProductSource } from '@petvold/billing';
import { CatalogError, billingSettingsOf, onSale, policySettingsOf, productVersionId, vetCareTermsFor, type ProductService } from '@petvold/catalog';
import { DomainError, eventClaimId, type ClaimsEvent, type ClaimsService } from '@petvold/claims-core';
import type { SourceEvent as WebhookSourceEvent } from '@petvold/webhooks';
import type { ClaimSource, InvoiceSource, PartySource, PolicySource, SourceEvent as NoticeSourceEvent } from '@petvold/communications';
import { PartyError, type ActivitySource, type PartyService } from '@petvold/parties';
import { PolicyError, type AnimalPort, type PolicyService, type ProductPort } from '@petvold/policies';

/** Product versions as the policy module sees them (ADR 0023, 0029). */
export function productPort(products: ProductService): ProductPort {
  return {
    async offer(productVersion, onDate) {
      const [product, version] = productVersion.split('@');
      if (!product || !version) return null;
      const v = await products.get(product, version).catch((e: unknown) => {
        if (e instanceof CatalogError && e.code === 'not_found') return null;
        throw e;
      });
      if (!v) return null;
      const settings = policySettingsOf(v.content);
      return {
        product: v.product,
        market: v.content.market,
        currency: v.content.currency,
        species: [...v.content.species],
        onSale: onSale(v, onDate),
        midTermCancellation: settings.midTermCancellation,
        termMonths: settings.termMonths,
        renewalLeadDays: settings.renewalLeadDays,
        transferAcceptanceDays: settings.transferAcceptanceDays,
        applicationExpiryDays: settings.applicationExpiryDays,
        maxStartAheadDays: settings.maxStartAheadDays,
        paymentIntervals: [...billingSettingsOf(v.content).paymentIntervals],
        defaultPaymentInterval: billingSettingsOf(v.content).defaultPaymentInterval,
        ...(v.content.tariffSeries ? { tariffSeries: v.content.tariffSeries } : {}),
        ...(v.content.priceTermsSeries ? { priceTermsSeries: v.content.priceTermsSeries } : {}),
        ...(v.content.underwritingSeries ? { underwritingSeries: v.content.underwritingSeries } : {}),
        ...(v.content.documents?.length ? { documents: v.content.documents.map((x) => ({ type: x.type, language: x.language, sha256: x.sha256 })) } : {}),
        vetCareTermsFor: (choice) => ({ ...vetCareTermsFor(v, choice), deductibleOption: choice.deductible ?? v.content.vetCare.defaultDeductible }),
      };
    },
    async versionOnSale(product, onDate) {
      const v = (await products.onSale(onDate)).find((x) => x.product === product);
      return v ? productVersionId(v) : null;
    },
  };
}

/** Animals as the policy module sees them (ADR 0024, 0029). */
export function animalPort(animals: AnimalService): AnimalPort {
  return {
    async get(animalId) {
      const a = await animals.get(animalId).catch((e: unknown) => {
        if (e instanceof AnimalError && e.code === 'not_found') return null;
        throw e;
      });
      return a
        ? { market: a.market, species: a.species, ...(a.breed ? { breed: a.breed } : {}), birthDate: a.birthDate, ...(a.deceasedOn ? { deceasedOn: a.deceasedOn } : {}) }
        : null;
    },
  };
}

/**
 * The claims a party had, for retention (ADR 0028): claims on the policies the
 * party held, treated while it held them. Ongoing while one is open; otherwise
 * the day of the latest claim activity, e.g. the last decision.
 */
export function claimsActivity(policies: PolicyService, claims: ClaimsService): ActivitySource {
  return {
    name: 'claims',
    async activityOf(partyId) {
      let last: string | undefined;
      for (const period of await policies.holderPeriods(partyId)) {
        const a = await claims.claimActivity(period.policyId, period.from, period.to);
        if (a.open) return { ongoing: true };
        const day = a.lastAt?.slice(0, 10);
        if (day && (!last || day > last)) last = day;
      }
      return last ? { lastDate: last } : null;
    },
  };
}

/** Policies and applications as the communications module reads them (ADR 0032). */
/**
 * The claims engine as the communications module reads it (ADR 0036): a
 * decision with its explanation, and a request for information. Nothing else.
 */
export function claimSource(claims: ClaimsService): ClaimSource {
  const orNull = <T>(p: Promise<T>) =>
    p.catch((e: unknown) => {
      if (e instanceof DomainError && e.code === 'not_found') return null;
      throw e;
    });
  return {
    async decision(claimId, seq) {
      const claim = await orNull(claims.getClaim(claimId));
      const x = claim ? await orNull(claims.explainDecision(claimId, seq)) : null;
      if (!claim || !x) return null;
      return {
        claimId,
        claimNo: claim.claimNo,
        policyId: claim.policyId,
        animalId: claim.animalId,
        market: claim.market,
        treatmentFrom: claim.treatmentFrom,
        decisionId: x.decisionId,
        seq: x.seq,
        outcome: x.outcome,
        payout: { amount: x.payout, currency: x.currency },
        automated: x.automated,
        mainReason: x.mainReason,
        steps: x.steps,
        ...(x.deviation ? { deviation: x.deviation } : {}),
        reviewAvailable: x.humanReview.available,
      };
    },
    async informationRequest(claimId, requestId) {
      const claim = await orNull(claims.getClaim(claimId));
      const r = claim ? (await claims.getInformationRequests(claimId)).find((x) => x.id === requestId) : undefined;
      if (!claim || !r) return null;
      return {
        claimId,
        claimNo: claim.claimNo,
        policyId: claim.policyId,
        animalId: claim.animalId,
        market: claim.market,
        treatmentFrom: claim.treatmentFrom,
        requestId: r.id,
        recipient: r.recipient,
        items: [...r.items],
        note: r.note,
        dueDate: r.dueDate,
      };
    },
  };
}

/** A claims event as the communications module takes it: the claim, and the decision's seq or the request's id. */
export function claimsEventForNotices(entry: { id: string; event: ClaimsEvent }): (NoticeSourceEvent & { claimId: string }) | null {
  const e = entry.event;
  // The outbox's ids are numbers per source: the prefix keeps them apart from other sources' events.
  const base = { id: `claims:${entry.id}`, type: e.type, claimId: eventClaimId(e), occurredAt: e.occurredAt };
  if (e.type === 'claim.decided') return { ...base, data: { seq: e.decision.seq } };
  if (e.type === 'claim.information_requested' || e.type === 'claim.information_reminded' || e.type === 'claim.information_expired') {
    return { ...base, data: { requestId: e.request.id } };
  }
  return null;
}

export function policySource(policies: PolicyService): PolicySource {
  const orNull = <T>(p: Promise<T>) =>
    p.catch((e: unknown) => {
      if (e instanceof PolicyError && e.code === 'not_found') return null;
      throw e;
    });
  return {
    async policy(policyId) {
      const p = await orNull(policies.get(policyId));
      if (!p) return null;
      return {
        id: p.id,
        market: p.market,
        animalId: p.animalId,
        terms: p.terms.map((t) => ({
          termNo: t.termNo,
          startDate: t.startDate,
          endDate: t.endDate,
          productVersion: t.productVersion,
          currency: t.currency,
          premium: t.premium,
          vetCare: t.vetCare,
          deductibleOption: t.deductibleOption,
          riders: t.riders.map((r) => ({ description: r.description, diagnosisCodes: r.diagnosisCodes, validFrom: r.validFrom })),
        })),
        versions: p.versions.map((v) => ({ validFrom: v.validFrom, validTo: v.validTo, policyholderPartyId: v.policyholderPartyId, status: v.status })),
      };
    },
    async transaction(policyId, transactionId) {
      const tx = (await orNull(policies.transactions(policyId)))?.find((t) => t.id === transactionId);
      if (!tx) return null;
      return {
        type: tx.type,
        ...(tx.cancellation ? { cancellation: { ...tx.cancellation } } : {}),
        ...(tx.issue?.acceptance.documents ? { acceptedDocuments: tx.issue.acceptance.documents } : {}),
      };
    },
    async application(applicationId) {
      const a = await orNull(policies.getApplication(applicationId));
      if (!a) return null;
      const byPerson = a.decision?.outcome === 'declined';
      return {
        id: a.id,
        market: a.market,
        animalId: a.animalId,
        policyholderPartyId: a.policyholderPartyId,
        productVersion: a.productVersion,
        reasons: byPerson ? (a.decision!.reason ? [a.decision!.reason] : []) : [...a.underwriting.result.reasons],
        decidedBy: byPerson ? 'person' : 'rules',
      };
    },
    async proposal(proposalId) {
      const p = await orNull(policies.getProposal(proposalId));
      if (!p || p.kind !== 'transfer' || !('toPartyId' in p.details)) return null;
      return { id: p.id, kind: p.kind, fromPartyId: p.details.fromPartyId, toPartyId: p.details.toPartyId, from: p.details.from, deadline: p.deadline! };
    },
  };
}

/** The party's language for the communications module. */
export function partySource(parties: PartyService): PartySource {
  return {
    async languageOf(partyId) {
      const p = await parties.get(partyId).catch((e: unknown) => {
        if (e instanceof PartyError && e.code === 'not_found') return null;
        throw e;
      });
      return p?.language;
    },
  };
}

/**
 * A claims event as the webhooks module takes it (ADR 0033): flat, with the
 * fields the public catalog allows to pick from. Who decided, the customer's
 * statement and the assessment stay inside Petvold.
 */
export async function claimsEventForWebhooks(
  entry: { id: string; event: ClaimsEvent },
  marketOf: (claimId: string) => Promise<{ market: string; currency: string }>,
): Promise<WebhookSourceEvent> {
  const e = entry.event;
  const claimId = eventClaimId(e);
  const claim = e.type === 'claim.registered' ? { market: e.claim.market, currency: e.claim.currency } : await marketOf(claimId);
  const base = { id: entry.id, type: e.type, claimId, market: claim.market, occurredAt: e.occurredAt, sequence: Number(entry.id) };
  switch (e.type) {
    case 'claim.registered': {
      const c = e.claim;
      return {
        ...base,
        data: {
          claimNo: c.claimNo,
          policyId: c.policyId,
          animalId: c.animalId,
          channel: c.channel,
          ...(c.clinicId ? { clinicId: c.clinicId } : {}),
          treatmentFrom: c.treatmentFrom,
          treatmentTo: c.treatmentTo,
          diagnosisCode: c.diagnosisCode,
          currency: c.currency,
        },
      };
    }
    case 'claim.decided': {
      const d = e.decision;
      return {
        ...base,
        data: {
          decisionId: d.id,
          seq: d.seq,
          outcome: d.outcome,
          payout: d.payout,
          currency: claim.currency,
          automated: d.automated,
          deviatesFromProposal: d.deviatesFromProposal,
          ...(d.reasonCode ? { reasonCode: d.reasonCode } : {}),
          ...(d.reviewRequestId ? { reviewRequestId: d.reviewRequestId } : {}),
        },
      };
    }
    case 'claim.decision_proposed':
    case 'claim.proposal_returned': {
      const p = e.proposal;
      return {
        ...base,
        data:
          e.type === 'claim.proposal_returned'
            ? { proposalId: p.id }
            : { proposalId: p.id, action: p.action, outcome: p.outcome, payout: p.payout, currency: p.currency, deviatesFromProposal: p.deviatesFromProposal, ...(p.reasonCode ? { reasonCode: p.reasonCode } : {}) },
      };
    }
    case 'claim.payout_ordered': {
      const o = e.order;
      return {
        ...base,
        data: { payoutOrderId: o.id, decisionId: o.decisionId, policyId: o.policyId, amount: o.amount, currency: o.currency, channel: o.channel, ...(o.clinicId ? { clinicId: o.clinicId } : {}) },
      };
    }
    case 'claim.payout_reduced': {
      const r = e.reduction;
      return {
        ...base,
        data: { payoutReductionId: r.id, decisionId: r.decisionId, policyId: r.policyId, amount: r.amount, currency: r.currency, channel: r.channel, ...(r.clinicId ? { clinicId: r.clinicId } : {}) },
      };
    }
    case 'claim.review_requested':
      return { ...base, data: { reviewRequestId: e.request.id, decisionId: e.request.decisionId, decisionSeq: e.request.decisionSeq } };
    case 'claim.withdrawn':
    case 'claim.dismissed': {
      // The reason is free text and may name a person, so it stays inside Petvold.
      const k = e.closure;
      return { ...base, data: { closureId: k.id, ...(k.reasonCode ? { reasonCode: k.reasonCode } : {}), ...(k.duplicateOf ? { duplicateOf: k.duplicateOf } : {}) } };
    }
    case 'claim.attachment_added': {
      // The archive's address and the checksum, not the file; the archive decides who may open it.
      const a = e.attachment;
      return {
        ...base,
        data: { attachmentId: a.id, kind: a.kind, mediaType: a.mediaType, size: a.size, sha256: a.sha256, url: a.url, ...(a.replaces ? { replaces: a.replaces } : {}) },
      };
    }
    case 'claim.corrected': {
      // Which fields changed, not the new values or the reason: they stay inside Petvold.
      const k = e.correction;
      return { ...base, data: { correctionId: k.id, revision: k.revision, fields: k.fields, reopens: k.reopens } };
    }
    case 'claim.information_requested':
    case 'claim.information_reminded':
    case 'claim.information_received':
    case 'claim.information_expired':
    case 'claim.information_cancelled': {
      // The notes are free text and may name a person, so they stay inside Petvold.
      const r = e.request;
      return { ...base, data: { requestId: r.id, recipient: r.recipient, items: r.items, dueDate: r.dueDate, status: r.status } };
    }
  }
}

/** The product catalog as billing reads it (ADR 0040): the market, currency and billing settings. */
export function billingProductSource(products: ProductService): BillingProductSource {
  return {
    async billing(productVersion) {
      const [product, version] = productVersion.split('@');
      if (!product || !version) return null;
      const v = await products.get(product, version).catch((e: unknown) => {
        if (e instanceof CatalogError && e.code === 'not_found') return null;
        throw e;
      });
      if (!v) return null;
      const b = billingSettingsOf(v.content);
      return { market: v.content.market, currency: v.content.currency, paymentIntervals: b.paymentIntervals, defaultPaymentInterval: b.defaultPaymentInterval, installmentFee: b.installmentFee, invoiceLeadDays: b.invoiceLeadDays };
    },
  };
}

/** The policy module as billing reads it: the policyholder on a day. */
export function billingPolicySource(policies: PolicyService): BillingPolicySource {
  return {
    async policyholderOn(policyId, date) {
      const p = await policies.get(policyId).catch((e: unknown) => {
        if (e instanceof PolicyError && e.code === 'not_found') return null;
        throw e;
      });
      if (!p) return null;
      const v = p.versions.find((x) => x.validFrom <= date && date < x.validTo) ?? p.versions.filter((x) => x.validFrom <= date).at(-1) ?? p.versions[0];
      return v?.policyholderPartyId ?? null;
    },
  };
}

/**
 * What billing asks of the policy module for unpaid premium (ADR 0040, punkt 7).
 * The same policy and day again gives the cancellation already made, so a run
 * that stopped halfway can run again.
 */
export function billingPolicyActions(policies: PolicyService): PolicyActions {
  return {
    async cancelForUnpaidPremium(policyId, sentOn, note, by) {
      const made = (await policies.transactions(policyId)).find((t) => t.type === 'cancel' && t.cancellation?.reason === 'unpaid-premium' && t.cancellation.receivedOn === sentOn);
      if (made) return { transactionId: made.id, effectiveDate: made.cancellation!.effectiveDate };
      try {
        const tx = await policies.cancel(policyId, { reason: 'unpaid-premium', receivedOn: sentOn, note }, by);
        return { transactionId: tx.id, effectiveDate: tx.cancellation!.effectiveDate };
      } catch (e) {
        if (e instanceof PolicyError) return { skipped: e.message };
        throw e;
      }
    },
    async reverseCancellation(policyId, transactionId, note, by) {
      try {
        await policies.reinstate(policyId, { cancellationId: transactionId, note }, by);
        return { reversed: true };
      } catch (e) {
        if (e instanceof PolicyError) return { failed: e.message };
        throw e;
      }
    },
  };
}

/** Billing's invoices and credit notes as accounting reads them (ADR 0040, punkt 9). */
export function accountingSources(billing: BillingService): AccountingSources {
  const orNull = async <T>(p: Promise<T>): Promise<T | null> =>
    p.catch((e: unknown) => {
      if (e instanceof BillingError && e.code === 'not_found') return null;
      throw e;
    });
  return {
    async invoice(id) {
      const i = await orNull(billing.invoice(id));
      return i ? { id: i.id, number: i.number, accountId: i.accountId, market: i.market, currency: i.currency, issueDate: i.issueDate, lines: i.lines.map((l) => ({ ...l })) } : null;
    },
    async creditNote(id) {
      const c = await orNull(billing.creditNote(id));
      return c ? { id: c.id, number: c.number, kind: c.kind, invoiceId: c.invoiceId, accountId: c.accountId, market: c.market, currency: c.currency, issueDate: c.issueDate, lines: c.lines.map((l) => ({ ...l })), total: c.total } : null;
    },
  };
}

/** Billing's invoices as the notices read them (ADR 0040). */
export function invoiceSource(billing: BillingService): Required<InvoiceSource> {
  return {
    async invoice(id) {
      const i = await billing.invoice(id).catch((e: unknown) => {
        if (e instanceof BillingError && e.code === 'not_found') return null;
        throw e;
      });
      if (!i) return null;
      return {
        id: i.id,
        number: i.number,
        partyId: i.partyId,
        market: i.market,
        currency: i.currency,
        issueDate: i.issueDate,
        dueDate: i.dueDate,
        reference: { ...i.reference },
        total: i.total,
        lines: i.lines.map((l) => ({ policyId: l.policyId, periodStart: l.periodStart, periodEnd: l.periodEnd, premium: l.premium, tax: l.tax, fee: l.fee, amount: l.amount })),
      };
    },
    async creditNote(id) {
      const c = await billing.creditNote(id).catch((e: unknown) => {
        if (e instanceof BillingError && e.code === 'not_found') return null;
        throw e;
      });
      if (!c) return null;
      return {
        id: c.id,
        number: c.number,
        kind: c.kind,
        invoiceId: c.invoiceId,
        partyId: c.partyId,
        market: c.market,
        currency: c.currency,
        issueDate: c.issueDate,
        total: c.total,
        cause: c.source.eventType,
        lines: c.lines.map((l) => ({ policyId: l.policyId, amount: l.amount })),
      };
    },
  };
}
