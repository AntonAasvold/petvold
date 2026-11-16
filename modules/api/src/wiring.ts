/**
 * Adapters that connect one module's port to another module's service, so the
 * modules themselves never depend on each other (ADR 0001). Used by createApp
 * and by the dev server.
 */
import { AnimalError, type AnimalService } from '@petvold/animals';
import { CatalogError, onSale, policySettingsOf, productVersionId, vetCareTermsFor, type ProductService } from '@petvold/catalog';
import type { ClaimsService } from '@petvold/claims-core';
import type { PartySource, PolicySource } from '@petvold/communications';
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
