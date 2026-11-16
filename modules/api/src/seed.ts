/**
 * Sample data for the dev server and a user interface to work against. Made up
 * (ADR 0009). Each part is created only if it is not there, so restarts keep
 * what was changed. Never used by server.ts.
 *
 * - The sample rules, tariff, price terms, reference data and products.
 * - Bella, her owner and policy, and four claims: one in each work queue.
 * - Doris in Gothenburg, with a policy priced by the tariff.
 * - A household in Malmo: Max and Ludde insured together with the household
 *   discount, and the cat Smilla without insurance.
 * - Applications in Uppsala for the product with health questions (ADR 0031):
 *   Kajsa accepted with a rider, Rocky referred and Sixten declined as too old.
 */
import { CALCULATION_MODEL, type Claim } from '@petvold/claims-core';
import { marketDate } from '@petvold/common';
import { fixtures } from '@petvold/claims-store-memory';
import { isReferenceKind, productChecksum, type ProductVersion } from '@petvold/catalog';
import { ruleSetChecksum, type RuleSetStore, type RuleSetVersion } from '@petvold/decisioning';
import { PRICE_TERMS, TARIFF } from '@petvold/pricing-core/fixtures';
import referenceSeed from '@petvold/catalog/seed/reference-data.json' with { type: 'json' };
import productSeed from '@petvold/catalog/seed/products.json' with { type: 'json' };
import underwritingSeed from '../seed/underwriting-rules.json' with { type: 'json' };
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
  await publishSeries(stores.rules, 'SE-HUND-UW', underwritingSeed, 'underwriting.v1', now);

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

  await seedClaims(inst);
  await seedHouseholds(inst, now, by);
  await seedApplications(inst, now, by);
}

/**
 * Bella's claims, one in each work queue (GET /v1/claims?state=…):
 * decided automatically, review requested, awaiting decision and awaiting approval.
 */
async function seedClaims(inst: Installation): Promise<void> {
  const claims = inst.deps.service;
  const exists = (id: string) => claims.getClaim(id).then(() => true, () => false);

  // decided: settled automatically in June.
  if (!(await exists('clm_021877'))) await claims.registerClaim(fixtures.otitisClaim());

  // review-requested: the ear again in September, settled automatically, and the customer asks for a person.
  if (!(await exists('clm_033410'))) {
    const { decision } = await claims.registerClaim(
      fixtures.otitisClaim({
        id: 'clm_033410',
        claimNo: 'S-2026-033410',
        channel: 'customer',
        treatmentFrom: '2026-09-15',
        treatmentTo: '2026-09-15',
        receivedAt: '2026-09-16T18:20:00Z',
        lines: [
          { id: 'l1', description: 'Examination', category: 'examination', amount: 65_000 },
          { id: 'l2', description: 'Ear cytology', category: 'diagnostics', amount: 48_000 },
          { id: 'l3', description: 'Ear drops', category: 'medication', amount: 29_000 },
        ],
      }),
    );
    if (decision) await claims.requestReview('clm_033410', decision.seq, { requestedBy: 'customer-portal', statement: 'The cytology was ordered by the vet and should be covered in full.' });
  }

  // awaiting-decision: the cruciate surgery, with a rider that may apply.
  if (!(await exists('clm_048213'))) await claims.registerClaim(fixtures.cruciateClaim());

  // awaiting-approval: a large surgery a handler accepted above their limit (SEK 25,000).
  if (!(await exists('clm_050977'))) {
    await claims.registerClaim(LARGE_CLAIM);
    await claims.decide('clm_050977', {
      action: 'accept',
      decidedBy: 'handlaggare@example.test',
      reason: 'Foreign body confirmed by ultrasound',
      decisionLimits: { SEK: 2_500_000, EUR: 250_000 },
    });
  }
}

const LARGE_CLAIM: Claim = {
  id: 'clm_050977',
  claimNo: 'S-2026-050977',
  policyId: 'pol_bella',
  animalId: 'ani_bella',
  market: 'SE',
  currency: 'SEK',
  channel: 'clinic_direct',
  treatmentFrom: '2026-11-08',
  treatmentTo: '2026-11-10',
  diagnosisCode: 'GI-ENTERIT',
  receivedAt: '2026-11-12T08:15:00Z',
  lines: [
    { id: 'l1', description: 'Emergency examination', category: 'examination', amount: 120_000 },
    { id: 'l2', description: 'Ultrasound, abdomen', category: 'diagnostics', amount: 310_000 },
    { id: 'l3', description: 'Anaesthesia', category: 'anaesthesia', amount: 180_000 },
    { id: 'l4', description: 'Laparotomy, removal of foreign body', category: 'surgery', amount: 2_600_000 },
    { id: 'l5', description: 'Hospital care, 2 days', category: 'hospitalisation', amount: 540_000 },
    { id: 'l6', description: 'Medication', category: 'medication', amount: 95_000 },
  ],
};

interface SampleAnimal {
  id: string;
  name: string;
  species: 'dog' | 'cat';
  breed: string;
  sex: 'male' | 'female';
  birthDate: string;
  chip: string;
}

/** More owners and animals, with policies issued through the policy service so the tariff prices them. */
async function seedHouseholds(inst: Installation, now: string, by: string): Promise<void> {
  const { stores } = inst;
  const policies = inst.deps.policies!;
  const today = marketDate('SE', now);

  const person = async (id: string, givenName: string, address: { street: string; postalCode: string; city: string }) => {
    if (await stores.parties.get(id)) return;
    await stores.parties.register(
      { id, revision: 1, kind: 'person', market: 'SE', givenName, familyName: 'Example', email: `${givenName.toLowerCase()}@example.test`, address: { ...address, country: 'SE' }, language: 'sv', changedBy: by, changedAt: now },
      [],
    );
  };
  const animal = async (a: SampleAnimal, ownerId: string) => {
    if (await stores.animals.get(a.id)) return;
    await stores.animals.register(
      { id: a.id, revision: 1, market: 'SE', species: a.species, breed: a.breed, sex: a.sex, neutered: false, name: a.name, birthDate: a.birthDate, allowLookup: true, changedBy: by, changedAt: now },
      [{ type: 'microchip', value: a.chip, addedBy: by, addedAt: now }],
      { seq: 1, partyId: ownerId, validFrom: a.birthDate, recordedBy: by, recordedAt: now },
    );
  };
  const insure = async (animalId: string, holder: string, groupId?: string) => {
    if ((await policies.findByAnimal(animalId)).length > 0) return;
    await policies.issue(
      {
        market: 'SE',
        animalId,
        policyholderPartyId: holder,
        productVersion: 'SE-HUND-BAS@2026.1',
        startDate: today,
        acceptance: { channel: 'web', reference: `seed-${animalId}`, acceptedAt: now },
        ...(groupId ? { groupId } : {}),
      },
      by,
    );
  };

  // Doris in Gothenburg.
  await person('pty_owner002', 'Erik', { street: 'Example Road 2', postalCode: '41101', city: 'Gothenburg' });
  await animal({ id: 'ani_doris', name: 'Doris', species: 'dog', breed: 'dog-golden-retriever', sex: 'female', birthDate: '2023-05-02', chip: '752098100000002' }, 'pty_owner002');
  await insure('ani_doris', 'pty_owner002');

  // A household in Malmo: two dogs insured together, and a cat without insurance.
  await person('pty_owner003', 'Sara', { street: 'Example Square 3', postalCode: '21115', city: 'Malmo' });
  await animal({ id: 'ani_max', name: 'Max', species: 'dog', breed: 'dog-german-shepherd', sex: 'male', birthDate: '2021-08-19', chip: '752098100000003' }, 'pty_owner003');
  await animal({ id: 'ani_ludde', name: 'Ludde', species: 'dog', breed: 'dog-mixed', sex: 'male', birthDate: '2024-02-11', chip: '752098100000004' }, 'pty_owner003');
  await animal({ id: 'ani_smilla', name: 'Smilla', species: 'cat', breed: 'cat-domestic', sex: 'female', birthDate: '2022-10-01', chip: '752098100000005' }, 'pty_owner003');
  if ((await policies.findByAnimal('ani_max')).length === 0) {
    const group = await policies.createGroup({ market: 'SE', kind: 'household', holderPartyId: 'pty_owner003' }, by);
    await insure('ani_max', 'pty_owner003', group.id);
    await insure('ani_ludde', 'pty_owner003', group.id);
  }
}

/**
 * Applications for SE-HUND-PLUS, which has health questions (ADR 0031): one in
 * each outcome, so the queue for manual underwriting has one waiting.
 */
async function seedApplications(inst: Installation, now: string, by: string): Promise<void> {
  const { stores } = inst;
  const policies = inst.deps.policies!;
  if ((await policies.listApplications({ policyholderPartyId: 'pty_owner004' })).length > 0) return;
  if (!(await stores.parties.get('pty_owner004'))) {
    await stores.parties.register(
      {
        id: 'pty_owner004',
        revision: 1,
        kind: 'person',
        market: 'SE',
        givenName: 'Lena',
        familyName: 'Example',
        email: 'lena@example.test',
        address: { street: 'Example Lane 4', postalCode: '75310', city: 'Uppsala', country: 'SE' },
        language: 'sv',
        changedBy: by,
        changedAt: now,
      },
      [],
    );
  }
  const dogs = [
    { id: 'ani_kajsa', name: 'Kajsa', breed: 'dog-labrador-retriever', sex: 'female' as const, birthDate: '2023-04-10', chip: '752098100000006' },
    { id: 'ani_rocky', name: 'Rocky', breed: 'dog-mixed', sex: 'male' as const, birthDate: '2022-09-01', chip: '752098100000007' },
    { id: 'ani_sixten', name: 'Sixten', breed: 'dog-golden-retriever', sex: 'male' as const, birthDate: '2014-06-20', chip: '752098100000008' },
  ];
  for (const a of dogs) {
    if (await stores.animals.get(a.id)) continue;
    await stores.animals.register(
      { id: a.id, revision: 1, market: 'SE', species: 'dog', breed: a.breed, sex: a.sex, neutered: false, name: a.name, birthDate: a.birthDate, allowLookup: true, changedBy: by, changedAt: now },
      [{ type: 'microchip', value: a.chip, addedBy: by, addedAt: now }],
      { seq: 1, partyId: 'pty_owner004', validFrom: a.birthDate, recordedBy: by, recordedAt: now },
    );
  }
  // The customer was shown the Swedish terms and pre-contract information (ADR 0032),
  // as the stored version has them: an older local database may have the product without documents.
  const shown = ((await stores.products.get('SE-HUND-PLUS', '2026.1'))?.content.documents ?? [])
    .filter((x) => x.language === 'sv' && x.type !== 'ipid')
    .map((x) => ({ type: x.type, language: x.language, sha256: x.sha256 }));
  const apply = (animalId: string, answers: { question: string; value: boolean; diagnosisCodes?: string[] }[]) =>
    policies.apply(
      {
        market: 'SE',
        animalId,
        policyholderPartyId: 'pty_owner004',
        productVersion: 'SE-HUND-PLUS@2026.1',
        startDate: marketDate('SE', now),
        acceptance: { channel: 'web', reference: `seed-${animalId}`, acceptedAt: now, ...(shown.length ? { documents: shown } : {}) },
        answers,
      },
      by,
    );
  const no = (question: string) => ({ question, value: false });
  // Kajsa had an ear infection: accepted with a rider for it.
  await apply('ani_kajsa', [{ question: 'previous-illness', value: true, diagnosisCodes: ['ORA-OTIT'] }, no('ongoing-symptoms'), no('lameness')]);
  // Rocky has symptoms no vet has examined: referred to a person.
  await apply('ani_rocky', [no('previous-illness'), { question: 'ongoing-symptoms', value: true }, no('lameness')]);
  // Sixten is 12 years old: declined.
  await apply('ani_sixten', [no('previous-illness'), no('ongoing-symptoms'), no('lameness')]);
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
