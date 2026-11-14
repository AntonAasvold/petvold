import type {
  ClaimDecision,
  ClaimsRules,
  DeductiblePeriod,
  ISODate,
  LedgerJournal,
  MinorUnits,
  PolicySnapshot,
  Timestamp,
  Claim,
} from './types.ts';

/**
 * Det enda skademotorn vet om policykärnan. Implementeras som ett tunt
 * anti-corruption layer mot befintlig kärna, Socotra eller en egen policykärna.
 */
export interface PolicyPort {
  /**
   * Policyn som den gällde på `onDate`, enligt vad policykärnan visste vid
   * `knownAt` (utelämnat = nu). null om ingen version gällde det datumet.
   */
  getPolicyAt(policyId: string, onDate: ISODate, knownAt?: Timestamp): Promise<PolicySnapshot | null>;
}

/** Produktens skaderegler per produktversion. */
export interface RulesPort {
  getRules(productVersion: string): Promise<ClaimsRules>;
}

/** Skademotorns eget tillstånd. Postgres i drift, i minnet i tester. */
export interface ClaimsStore {
  /** Kastar StoreConflictError('claim_exists') om id:t redan finns. */
  saveClaim(claim: Claim): Promise<void>;
  getClaim(claimId: string): Promise<Claim | null>;

  /**
   * Självriskperiod för djur och diagnosgrupp som täcker `onDate`.
   * Perioder som öppnats av `excludeClaimId` ignoreras, så att en omprövning
   * räknar på samma sätt som det ursprungliga beslutet.
   */
  findDeductiblePeriod(
    animalId: string,
    diagnosisGroup: string,
    onDate: ISODate,
    excludeClaimId?: string,
  ): Promise<DeductiblePeriod | null>;

  /**
   * Förbrukat försäkringsbelopp för djur, moment och försäkringsår, enligt ledgern.
   * Ärendets eget tidigare förbrukade belopp exkluderas vid omprövning.
   */
  getConsumed(animalId: string, coverage: string, policyYearStart: ISODate, excludeClaimId?: string): Promise<MinorUnits>;

  /** Ärendets beslut i stigande löpnummer. Tom lista om inga finns. */
  getDecisions(claimId: string): Promise<ClaimDecision[]>;
  /**
   * Sparar beslut, journaler och ändrade självriskperioder atomiskt
   * (en databastransaktion i drift). Perioder som ärendet tidigare öppnat
   * ersätts av `deductiblePeriod` (eller tas bort om den är null).
   *
   * Allt eller inget: vid fel sparas ingenting. Kastar StoreConflictError med
   * 'decision_exists' (samma ärende och löpnummer) eller 'period_overlaps'
   * (krock med ett annat ärendes självriskperiod). En journal som inte
   * balanserar eller ett beslut för ett okänt ärende avvisas med ett vanligt fel.
   */
  commitDecision(commit: DecisionCommit): Promise<void>;
}

/**
 * Lagringen avvisar en ändring som krockar med befintligt tillstånd.
 * Alla implementationer kastar detta fel för samma situationer, så att
 * tjänsten kan svara 409 i stället för 500 (se test-suites/claims-store.ts).
 */
export class StoreConflictError extends Error {
  constructor(
    public readonly reason: 'claim_exists' | 'decision_exists' | 'period_overlaps',
    message: string,
  ) {
    super(message);
    this.name = 'StoreConflictError';
  }
}

export interface DecisionCommit {
  decision: ClaimDecision;
  journals: LedgerJournal[];
  deductiblePeriod: DeductiblePeriod | null;
}

export interface Clock {
  now(): Timestamp;
}

export interface IdGenerator {
  next(prefix: string): string;
}

export type ClaimsEvent =
  | { type: 'claim.registered'; occurredAt: Timestamp; claim: Claim }
  | { type: 'claim.decided'; occurredAt: Timestamp; decision: ClaimDecision };

/**
 * Utgående händelser. I drift skrivs de till en outbox i samma
 * databastransaktion som ändringen och publiceras därifrån.
 */
export interface EventSink {
  publish(event: ClaimsEvent): Promise<void>;
}
