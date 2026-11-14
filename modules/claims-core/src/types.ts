/**
 * Domäntyper för skademotorn.
 *
 * Konventioner (se @petvold/common):
 * - Belopp är heltal i minsta valutaenhet. Aldrig flyttal för pengar.
 * - Datum är ISO-datum 'YYYY-MM-DD' utan tid. Tidpunkter är ISO-tidsstämplar.
 */
import type { CurrencyCode, ISODate, MarketCode, MinorUnits, Timestamp } from '@petvold/common';

export type { CurrencyCode, ISODate, MarketCode, MinorUnits, Timestamp };

// ---------------------------------------------------------------------------
// Skadeärende
// ---------------------------------------------------------------------------

export type ClaimChannel = 'clinic_direct' | 'customer';

export interface ClaimLine {
  id: string;
  description: string;
  /** Kategori enligt produktens skaderegler, t.ex. 'examination', 'surgery', 'food'. */
  category: string;
  /** Diagnoskod för raden om den avviker från ärendets huvuddiagnos. */
  diagnosisCode?: string;
  /** Belopp inklusive moms, i ärendets valuta. */
  amount: MinorUnits;
  /** Momsdelen av amount, om fakturan anger den. */
  vat?: MinorUnits;
}

export interface Claim {
  id: string;
  claimNo: string;
  policyId: string;
  animalId: string;
  market: MarketCode;
  currency: CurrencyCode;
  channel: ClaimChannel;
  treatmentFrom: ISODate;
  treatmentTo: ISODate;
  /** Huvuddiagnos för ärendet. */
  diagnosisCode: string;
  lines: ClaimLine[];
  receivedAt: Timestamp;
}

// ---------------------------------------------------------------------------
// Policydata som skademotorn läser (kontrakt mot policykärnan)
// ---------------------------------------------------------------------------

/**
 * Självriskmodell. Täcker de vanliga europeiska varianterna:
 * - 'period': fast självrisk en gång per självriskperiod och diagnosgrupp (t.ex. Norden)
 * - 'claim':  fast självrisk på varje skada
 * - 'policy_year': fast självrisk en gång per försäkringsår
 * plus rörlig självrisk som kan öka med djurets ålder.
 */
export interface DeductibleTerms {
  fixed: MinorUnits;
  fixedPer: 'period' | 'claim' | 'policy_year';
  /** Krävs när fixedPer är 'period'. */
  periodDays?: number;
  /** Rörlig självrisk i baspunkter: 2500 = 25 %. */
  variableBp: number;
  /** Högre rörlig självrisk från en viss ålder; den högsta tillämpliga gäller. */
  variableBpByAge?: Array<{ fromAgeYears: number; bp: number }>;
}

export interface VetCareTerms {
  code: 'vet_care';
  /** Försäkringsbelopp per försäkringsår. */
  annualLimit: MinorUnits;
  deductible: DeductibleTerms;
  /** Karenstid från försäkringens startdatum. */
  waitingPeriodDays: number;
}

export interface Rider {
  id: string;
  description: string;
  /** Diagnoskoder som undantas för just detta djur. */
  diagnosisCodes: string[];
  validFrom: ISODate;
  validTo?: ISODate;
}

/**
 * Policyn så som den gällde på ett visst datum (giltighetstid), enligt det
 * policykärnan visste vid en viss tidpunkt (registreringstid).
 */
export interface PolicySnapshot {
  policyId: string;
  /** Id för den bitemporala version som snapshoten bygger på. */
  policyVersionId: string;
  market: MarketCode;
  currency: CurrencyCode;
  animalId: string;
  animalBirthDate: ISODate;
  productVersion: string;
  status: 'active' | 'cancelled';
  /** Versionens giltighetsintervall, validTo exklusivt. */
  validFrom: ISODate;
  validTo?: ISODate;
  /** Försäkringens ursprungliga startdatum, för karenstid. */
  inceptionDate: ISODate;
  /** Det försäkringsår som behandlingsdatumet faller i, slut exklusivt. */
  policyYearStart: ISODate;
  policyYearEnd: ISODate;
  vetCare?: VetCareTerms;
  riders: Rider[];
}

// ---------------------------------------------------------------------------
// Produktens skaderegler (versionerad konfiguration)
// ---------------------------------------------------------------------------

export interface ClaimsRules {
  /** t.ex. 'SE-HUND-2026.2' */
  rulesVersion: string;
  market: MarketCode;
  /** Ersätts momsen på veterinärfakturor? Varierar mellan marknader och kundtyper. */
  vatReimbursable: boolean;
  /** Kategorier som aldrig ersätts, t.ex. foder. */
  nonReimbursableCategories: string[];
  /** Diagnoskod -> diagnosgrupp. Styr självriskperioder och förbehållsmatchning. */
  diagnosisGroups: Record<string, string>;
  /** Högsta ersättning som får regleras utan handläggare. */
  autoSettleMax: MinorUnits;
}

// ---------------------------------------------------------------------------
// Tillstånd som skademotorn själv äger
// ---------------------------------------------------------------------------

export interface DeductiblePeriod {
  id: string;
  animalId: string;
  /** Diagnosgrupp, eller '*' för en period som gäller hela försäkringsåret. */
  diagnosisGroup: string;
  validFrom: ISODate;
  /** Exklusivt slutdatum. */
  validTo: ISODate;
  openedByClaimId: string;
}

// ---------------------------------------------------------------------------
// Bedömning och beslut
// ---------------------------------------------------------------------------

export type RuleStatus = 'pass' | 'fail' | 'review' | 'info';

export type RuleCode =
  | 'POLICY_FOUND'
  | 'POLICY_ACTIVE'
  | 'ANIMAL_MATCHES'
  | 'MARKET_CURRENCY'
  | 'WAITING_PERIOD'
  | 'COVERAGE'
  | 'RIDER'
  | 'DIAGNOSIS_KNOWN'
  | 'LIMIT';

/**
 * Regelutfall utan text: `reason` är en stabil nyckel och `params` värdena.
 * Text på kundens eller handläggarens språk skapas i kanten (API, UI).
 * Belopp i params anges i minsta valutaenhet och har valutan i `currency`.
 */
export interface RuleResult {
  code: RuleCode;
  status: RuleStatus;
  reason: string;
  params: Record<string, string | number>;
}

export interface Calculation {
  billed: MinorUnits;
  nonReimbursable: MinorUnits;
  base: MinorUnits;
  currency: CurrencyCode;
  vatExcluded: MinorUnits;
  /** true om ärendet tar ut fast självrisk och öppnar en ny period (för 'period' och 'policy_year'). */
  opensDeductiblePeriod: boolean;
  deductibleVariableBp: number;
  deductibleFixed: MinorUnits;
  deductibleVariable: MinorUnits;
  payableBeforeLimit: MinorUnits;
  annualLimit: MinorUnits;
  consumedBefore: MinorUnits;
  remainingBefore: MinorUnits;
  payout: MinorUnits;
  /** Vad kunden betalar själv av det fakturerade beloppet. */
  customerShare: MinorUnits;
  cappedByLimit: boolean;
}

export type Outcome = 'approved' | 'partial' | 'rejected';
export type DecisionMode = 'auto' | 'manual';

export interface Assessment {
  claimId: string;
  market: MarketCode;
  currency: CurrencyCode;
  policyVersionId: string | null;
  productVersion: string | null;
  rulesVersion: string;
  rules: RuleResult[];
  calculation: Calculation | null;
  proposedOutcome: Outcome;
  mode: DecisionMode;
  diagnosisGroup: string | null;
  inputHash: string;
}

export interface ClaimDecision {
  id: string;
  claimId: string;
  /** 1, 2, 3 … – en ny rad per beslut eller omprövning, aldrig uppdatering. */
  seq: number;
  outcome: Outcome;
  payout: MinorUnits;
  assessment: Assessment;
  decidedBy: string;
  decidedAt: Timestamp;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Ledger (dubbel bokföring, append-only)
// ---------------------------------------------------------------------------

export interface LedgerLine {
  account: string;
  /** + debet, − kredit. Varje journal summerar till noll. */
  amount: MinorUnits;
}

export interface LedgerJournal {
  id: string;
  sourceType: 'claim_decision';
  sourceId: string;
  claimId: string;
  bookedAt: Timestamp;
  lines: LedgerLine[];
}
