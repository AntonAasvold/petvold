import type { Claim, ClaimsRules, PolicySnapshot } from '@petvold/claims-core';

/**
 * Sample data mirroring the design: Bella, a labrador, with a rider for
 * lameness in the right hind leg. Diagnosis codes are placeholders, not real VeNom codes.
 */

export const RULES_SE_DOG: ClaimsRules = {
  rulesVersion: 'SE-HUND-2026.2',
  market: 'SE',
  vatReimbursable: true,
  nonReimbursableCategories: ['food'],
  diagnosisGroups: {
    'ORT-KORSBAND-V': 'ortopedi-bakben',
    'ORT-KORSBAND-H': 'ortopedi-bakben',
    'ORT-HALTA-HB-H': 'ortopedi-bakben',
    'ORA-OTIT': 'ora',
    'GI-ENTERIT': 'mag-tarm',
  },
  autoSettleMax: 1_000_000, // SEK 10,000
};

export const PRODUCT = 'SE-HUND-VV-LIV@2026.2';

export function bellaPolicy(overrides: Partial<PolicySnapshot> = {}): PolicySnapshot {
  return {
    policyId: 'pol_bella',
    policyVersionId: 'pv_bella_v4',
    market: 'SE',
    currency: 'SEK',
    animalId: 'ani_bella',
    animalBirthDate: '2019-03-14',
    productVersion: PRODUCT,
    status: 'active',
    validFrom: '2026-04-01',
    validTo: '2027-04-01',
    inceptionDate: '2024-04-01',
    policyYearStart: '2026-04-01',
    policyYearEnd: '2027-04-01',
    vetCare: {
      code: 'vet_care',
      annualLimit: 6_000_000,
      deductible: { fixed: 200_000, fixedPer: 'period', periodDays: 125, variableBp: 2500 },
      waitingPeriodDays: 30,
    },
    riders: [
      {
        id: 'rid_halta_hh',
        description: 'Lameness, right hind leg',
        diagnosisCodes: ['ORT-HALTA-HB-H'],
        validFrom: '2025-09-12',
      },
    ],
    ...overrides,
  };
}

/** The cruciate ligament surgery from the design: SEK 18,640 billed. */
export function cruciateClaim(overrides: Partial<Claim> = {}): Claim {
  return {
    id: 'clm_048213',
    claimNo: 'S-2026-048213',
    policyId: 'pol_bella',
    animalId: 'ani_bella',
    market: 'SE',
    currency: 'SEK',
    channel: 'clinic_direct',
    treatmentFrom: '2026-11-11',
    treatmentTo: '2026-11-13',
    diagnosisCode: 'ORT-KORSBAND-V',
    receivedAt: '2026-11-13T13:32:00Z',
    lines: [
      { id: 'l1', description: 'Examination, orthopaedics', category: 'examination', amount: 85_000 },
      { id: 'l2', description: 'X-ray hind legs, 4 images', category: 'diagnostics', amount: 290_000 },
      { id: 'l3', description: 'Sedation and anaesthesia', category: 'anaesthesia', amount: 124_000 },
      { id: 'l4', description: 'TPLO surgery, left', category: 'surgery', amount: 1_240_000 },
      { id: 'l5', description: 'Pain relief, 10 days', category: 'medication', amount: 83_000 },
      { id: 'l6', description: 'Prescription food', category: 'food', amount: 42_000 },
    ],
    ...overrides,
  };
}

/** A small ear infection that is settled automatically. */
export function otitisClaim(overrides: Partial<Claim> = {}): Claim {
  return {
    id: 'clm_021877',
    claimNo: 'S-2026-021877',
    policyId: 'pol_bella',
    animalId: 'ani_bella',
    market: 'SE',
    currency: 'SEK',
    channel: 'clinic_direct',
    treatmentFrom: '2026-06-04',
    treatmentTo: '2026-06-04',
    diagnosisCode: 'ORA-OTIT',
    receivedAt: '2026-06-04T09:00:00Z',
    lines: [
      { id: 'l1', description: 'Examination', category: 'examination', amount: 65_000 },
      { id: 'l2', description: 'Ear flush and medication', category: 'medication', amount: 335_000 },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Example of another market, showing that the same engine carries other models.
// Made-up terms, not a description of any real market or product.
// ---------------------------------------------------------------------------

export const PRODUCT_EUR = 'XX-DOG-EXAMPLE@2026.1';

export const RULES_EUR_EXAMPLE: ClaimsRules = {
  rulesVersion: 'DE-DOG-EXAMPLE-2026.1',
  market: 'DE',
  vatReimbursable: false,
  nonReimbursableCategories: ['food', 'grooming'],
  diagnosisGroups: RULES_SE_DOG.diagnosisGroups,
  autoSettleMax: 50_000, // 500 EUR
};

/** Deductible per claim, variable deductible rising from age 8, VAT not reimbursed. */
export function eurPolicy(overrides: Partial<PolicySnapshot> = {}): PolicySnapshot {
  return {
    policyId: 'pol_rex',
    policyVersionId: 'pv_rex_v1',
    market: 'DE',
    currency: 'EUR',
    animalId: 'ani_rex',
    animalBirthDate: '2017-05-01',
    productVersion: PRODUCT_EUR,
    status: 'active',
    validFrom: '2026-01-01',
    validTo: '2027-01-01',
    inceptionDate: '2025-01-01',
    policyYearStart: '2026-01-01',
    policyYearEnd: '2027-01-01',
    vetCare: {
      code: 'vet_care',
      annualLimit: 500_000,
      deductible: {
        fixed: 5_000,
        fixedPer: 'claim',
        variableBp: 2000,
        variableBpByAge: [{ fromAgeYears: 8, bp: 3000 }],
      },
      waitingPeriodDays: 30,
    },
    riders: [],
    ...overrides,
  };
}

export function eurClaim(overrides: Partial<Claim> = {}): Claim {
  return {
    id: 'clm_rex_1',
    claimNo: 'X-2026-0001',
    policyId: 'pol_rex',
    animalId: 'ani_rex',
    market: 'DE',
    currency: 'EUR',
    channel: 'customer',
    treatmentFrom: '2026-10-02',
    treatmentTo: '2026-10-02',
    diagnosisCode: 'ORA-OTIT',
    receivedAt: '2026-10-03T08:00:00Z',
    lines: [
      { id: 'l1', description: 'Examination', category: 'examination', amount: 11_900, vat: 1_900 },
      { id: 'l2', description: 'Medication', category: 'medication', amount: 23_800, vat: 3_800 },
    ],
    ...overrides,
  };
}
