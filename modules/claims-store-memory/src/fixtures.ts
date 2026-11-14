import type { Claim, ClaimsRules, PolicySnapshot } from '@petvold/claims-core';

/**
 * Exempeldata som speglar designen: Bella, labrador, med förbehåll för
 * hälta höger bakben. Diagnoskoderna är platshållare, inte riktiga VeNom-koder.
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
  autoSettleMax: 1_000_000, // 10 000 kr
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
        description: 'Hälta, höger bakben',
        diagnosisCodes: ['ORT-HALTA-HB-H'],
        validFrom: '2025-09-12',
      },
    ],
    ...overrides,
  };
}

/** Korsbandsoperationen från designen: 18 640 kr fakturerat. */
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
      { id: 'l1', description: 'Undersökning, ortopedi', category: 'examination', amount: 85_000 },
      { id: 'l2', description: 'Röntgen bakben, 4 bilder', category: 'diagnostics', amount: 290_000 },
      { id: 'l3', description: 'Sedering och anestesi', category: 'anaesthesia', amount: 124_000 },
      { id: 'l4', description: 'Operation TPLO, vänster', category: 'surgery', amount: 1_240_000 },
      { id: 'l5', description: 'Smärtlindring, 10 dagar', category: 'medication', amount: 83_000 },
      { id: 'l6', description: 'Specialfoder', category: 'food', amount: 42_000 },
    ],
    ...overrides,
  };
}

/** En liten öroninflammation som regleras automatiskt. */
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
      { id: 'l1', description: 'Undersökning', category: 'examination', amount: 65_000 },
      { id: 'l2', description: 'Öronsköljning och läkemedel', category: 'medication', amount: 335_000 },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Exempel på en annan marknad, för att visa att samma motor bär andra modeller.
// Påhittade villkor, inte en beskrivning av någon verklig marknad eller produkt.
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

/** Självrisk per skada, rörlig självrisk som ökar från 8 års ålder, moms ersätts inte. */
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
