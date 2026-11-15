/**
 * Adapters that connect one module's port to another module's service, so the
 * modules themselves never depend on each other (ADR 0001). Used by createApp
 * and by the dev server.
 */
import { AnimalError, type AnimalService } from '@petvold/animals';
import { CatalogError, onSale, policySettingsOf, productVersionId, vetCareTermsFor, type ProductService } from '@petvold/catalog';
import type { AnimalPort, ProductPort } from '@petvold/policies';

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
      return a ? { market: a.market, species: a.species, birthDate: a.birthDate, ...(a.deceasedOn ? { deceasedOn: a.deceasedOn } : {}) } : null;
    },
  };
}
