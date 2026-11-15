/**
 * Sample data for the dev server: Bella, her owner and policy, the sample rules,
 * tariff, price terms, reference data and products. Made up (ADR 0009). Each
 * part is created only if it is not there, so restarts keep what was changed.
 * Never used by server.ts.
 */
import { CALCULATION_MODEL } from '@petvold/claims-core';
import { fixtures } from '@petvold/claims-store-memory';
import { isReferenceKind, productChecksum, type ProductVersion } from '@petvold/catalog';
import { ruleSetChecksum, type RuleSetStore, type RuleSetVersion } from '@petvold/decisioning';
import { PRICE_TERMS, TARIFF } from '@petvold/pricing-core/fixtures';
import referenceSeed from '@petvold/catalog/seed/reference-data.json' with { type: 'json' };
import productSeed from '@petvold/catalog/seed/products.json' with { type: 'json' };
import type { Installation } from './composition.ts';

export const SAMPLE_RULE_SERIES = 'SE-HUND-VV';

export async function seedSampleData(inst: Installation, clock: { now(): string }): Promise<void> {
  const { stores } = inst;
  const now = clock.now();
  const by = 'petvold-seed';

  // Rules, tariff and price terms: published at once. An installation seed, not a
  // review; in production the first version goes through draft, review and publication.
  const { rulesVersion: _v, ...rules } = fixtures.RULES_SE_DOG;
  await publishSeries(stores.rules, SAMPLE_RULE_SERIES, rules, CALCULATION_MODEL, now);
  await publishSeries(stores.rules, 'SE-HUND-TARIFF', TARIFF, 'tariff.v1', now);
  await publishSeries(stores.rules, 'SE-HUND-TERMS', PRICE_TERMS, 'price-terms.v1', now);

  // Reference data: parents come first in the file.
  for (const [kind, items] of Object.entries(referenceSeed)) {
    if (!isReferenceKind(kind)) continue;
    for (const i of items as { code: string; parent?: string; labels: Record<string, string> }[]) {
      if (await stores.references.get(kind, i.code)) continue;
      await inst.deps.catalog!.putReference(kind, i.code, { labels: i.labels, ...(i.parent ? { parent: i.parent } : {}) }, by);
    }
  }

  for (const p of productSeed as Pick<ProductVersion, 'product' | 'version' | 'salesFrom' | 'content'>[]) {
    if (await stores.products.get(p.product, p.version)) continue;
    const draft: ProductVersion = { ...p, status: 'draft', revision: 1, createdBy: by, createdAt: now };
    await stores.products.create(draft);
    await stores.products.update({
      ...draft,
      status: 'published',
      checksum: productChecksum(draft),
      revision: 2,
      submittedBy: by,
      submittedAt: now,
      publishedBy: 'petvold-install',
      publishedAt: now,
    });
  }

  // Bella's owner, without a personal number.
  if (!(await stores.parties.get('pty_owner001'))) {
    await stores.parties.register(
      {
        id: 'pty_owner001',
        revision: 1,
        kind: 'person',
        market: 'SE',
        givenName: 'Anna',
        familyName: 'Example',
        email: 'anna@example.test',
        address: { street: 'Example Street 1', postalCode: '11122', city: 'Stockholm', country: 'SE' },
        language: 'sv',
        changedBy: by,
        changedAt: now,
      },
      [],
    );
  }

  // Bella, with a microchip and her owner since she was a puppy.
  if (!(await stores.animals.get('ani_bella'))) {
    await stores.animals.register(
      { id: 'ani_bella', revision: 1, market: 'SE', species: 'dog', breed: 'dog-labrador-retriever', sex: 'female', neutered: true, name: 'Bella', birthDate: '2019-03-14', allowLookup: true, changedBy: by, changedAt: now },
      [{ type: 'microchip', value: '752098100000001', addedBy: by, addedAt: now }],
      { seq: 1, partyId: 'pty_owner001', validFrom: '2019-05-20', recordedBy: by, recordedAt: now },
    );
  }

  // Bella's policy, as known since 3 March 2026. Only the current term is in the sample.
  if (!(await stores.policies.get('pol_bella'))) {
    const snap = fixtures.bellaPolicy();
    const at = '2026-03-03T00:00:00.000Z';
    await stores.policies.issue(
      { id: 'pol_bella', market: 'SE', animalId: 'ani_bella', inceptionDate: snap.inceptionDate, createdBy: by, createdAt: at },
      {
        policyId: 'pol_bella',
        termNo: 1,
        startDate: snap.policyYearStart,
        endDate: snap.policyYearEnd,
        productVersion: snap.productVersion,
        currency: 'SEK',
        vetCare: snap.vetCare!,
        deductibleOption: 'standard',
        premium: 480_000,
        riders: snap.riders,
        transactionId: 'ptx_bellaseed',
      },
      {
        id: 'pv_bellav4',
        policyId: 'pol_bella',
        validFrom: snap.validFrom,
        validTo: snap.validTo!,
        sysFrom: at,
        policyholderPartyId: 'pty_owner001',
        status: 'active',
        termNo: 1,
        transactionId: 'ptx_bellaseed',
      },
      { id: 'ptx_bellaseed', policyId: 'pol_bella', type: 'issue', steps: [{ step: 'issued', at, note: 'Sample data' }], requestedBy: by, requestedAt: at },
      [],
    );
  }
}

async function publishSeries(store: RuleSetStore, series: string, content: unknown, calculationModel: string, now: string): Promise<void> {
  if ((await store.list(series)).length > 0) return;
  const base = { series, version: 1, content: content as never, calculationModel, effectiveFrom: '2026-01-01' };
  const v: RuleSetVersion = {
    ...base,
    status: 'published',
    checksum: ruleSetChecksum(base),
    revision: 2,
    createdBy: 'petvold-seed',
    createdAt: now,
    submittedBy: 'petvold-seed',
    submittedAt: now,
    publishedBy: 'petvold-install',
    publishedAt: now,
  };
  await store.create({ ...v, status: 'draft', revision: 1 } as RuleSetVersion);
  await store.update(v);
}
