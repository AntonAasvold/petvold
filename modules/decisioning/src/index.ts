/**
 * Rule sets as versioned data (ADR 0018, 0021).
 *
 * A rule series (e.g. 'SE-HUND-VV') has numbered versions. Each version holds
 * the product's claims rules, the calculation model and the date it applies
 * from. Lifecycle: draft -> in_review -> published -> retired. Publishing needs
 * someone other than the one who submitted it. A published version never changes.
 */
import { canonicalJson, sha256, type ClaimsRules, type ISODate, type RulesPort } from '@petvold/claims-core';

export type RuleSetStatus = 'draft' | 'in_review' | 'published' | 'retired';

/** The rules without their version: what an author writes. */
export type RuleSetContent = Omit<ClaimsRules, 'rulesVersion' | 'rulesChecksum'>;

export interface RuleSetVersion {
  series: string;
  version: number;
  status: RuleSetStatus;
  content: RuleSetContent;
  /** One of the engine's calculation models, e.g. 'vet-care.v1'. */
  calculationModel: string;
  /** The first treatment date the version applies to. */
  effectiveFrom: ISODate;
  /** sha256 over content, calculation model and effectiveFrom. Set when submitted for review. */
  checksum?: string;
  /** Increases with every change, for optimistic locking. */
  revision: number;
  createdBy: string;
  createdAt: string;
  submittedBy?: string;
  submittedAt?: string;
  publishedBy?: string;
  publishedAt?: string;
  retiredBy?: string;
  retiredAt?: string;
  /** Why a version was returned to draft or retired. */
  note?: string;
}

export interface RuleSetStore {
  /** All versions in the series, oldest first. */
  list(series: string): Promise<RuleSetVersion[]>;
  get(series: string, version: number): Promise<RuleSetVersion | null>;
  /** Stores a new version. Throws RuleSetConflictError if it is not the next number in the series. */
  create(v: RuleSetVersion): Promise<void>;
  /**
   * Replaces a version. Throws RuleSetConflictError if the stored revision is not
   * `v.revision - 1`, or if another published version in the series has the same effectiveFrom.
   */
  update(v: RuleSetVersion): Promise<void>;
}

export class RuleSetConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuleSetConflictError';
  }
}

export type RuleSetErrorCode = 'not_found' | 'validation' | 'conflict' | 'forbidden';

export class RuleSetError extends Error {
  constructor(
    public readonly code: RuleSetErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RuleSetError';
  }
}

export interface DraftInput {
  content: RuleSetContent;
  calculationModel: string;
  effectiveFrom: ISODate;
}

export interface DecisioningDeps {
  store: RuleSetStore;
  clock: { now(): string };
  /** The calculation models the engine has, e.g. Object.keys(CALCULATION_MODELS). */
  calculationModels: readonly string[];
}

/** The checksum of a rule set version's content (ADR 0021). */
export function ruleSetChecksum(v: Pick<RuleSetVersion, 'content' | 'calculationModel' | 'effectiveFrom'>): string {
  return sha256({ content: v.content, calculationModel: v.calculationModel, effectiveFrom: v.effectiveFrom });
}

/** The rules as the claims engine uses them. */
export function toClaimsRules(v: RuleSetVersion): ClaimsRules {
  return { ...v.content, rulesVersion: `${v.series}@${v.version}`, ...(v.checksum ? { rulesChecksum: v.checksum } : {}) };
}

/** The published version in force on a date: the latest effectiveFrom not after it. */
export function inForce(versions: readonly RuleSetVersion[], onDate: ISODate): RuleSetVersion | null {
  return (
    versions
      .filter((v) => v.status === 'published' && v.effectiveFrom <= onDate)
      .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : a.effectiveFrom > b.effectiveFrom ? -1 : b.version - a.version))[0] ?? null
  );
}

const SERIES = /^[A-Z0-9][A-Z0-9-]{1,63}$/;

export class DecisioningService {
  constructor(private readonly d: DecisioningDeps) {}

  async list(series: string): Promise<RuleSetVersion[]> {
    return this.d.store.list(series);
  }

  async get(series: string, version: number): Promise<RuleSetVersion> {
    const v = await this.d.store.get(series, version);
    if (!v) throw new RuleSetError('not_found', `Rule set ${series}@${version} does not exist`);
    return v;
  }

  /** A new draft in the series, with the next version number. */
  async createDraft(series: string, input: DraftInput, by: string): Promise<RuleSetVersion> {
    if (!SERIES.test(series)) throw new RuleSetError('validation', `Invalid series '${series}': capital letters, digits and hyphens`);
    this.validate(input);
    const existing = await this.d.store.list(series);
    const v: RuleSetVersion = {
      series,
      version: (existing.at(-1)?.version ?? 0) + 1,
      status: 'draft',
      ...input,
      revision: 1,
      createdBy: by,
      createdAt: this.d.clock.now(),
    };
    await this.d.store.create(v).catch(this.asConflict);
    return v;
  }

  /** Changes a draft. Only drafts can change. */
  async updateDraft(series: string, version: number, input: DraftInput): Promise<RuleSetVersion> {
    const v = await this.inStatus(series, version, 'draft');
    this.validate(input);
    return this.save({ ...v, ...input });
  }

  /** Locks the content for review and computes its checksum. */
  async submit(series: string, version: number, by: string): Promise<RuleSetVersion> {
    const v = await this.inStatus(series, version, 'draft');
    const { note: _note, ...rest } = v;
    return this.save({ ...rest, status: 'in_review', checksum: ruleSetChecksum(v), submittedBy: by, submittedAt: this.d.clock.now() });
  }

  /** Sends a version in review back to draft, with a reason. */
  async returnToDraft(series: string, version: number, reason: string): Promise<RuleSetVersion> {
    const v = await this.inStatus(series, version, 'in_review');
    const note = this.reason(reason);
    const { checksum: _c, submittedBy: _s, submittedAt: _a, ...rest } = v;
    return this.save({ ...rest, status: 'draft', note });
  }

  /** Publishes a version in review. Someone other than the submitter (four eyes). */
  async publish(series: string, version: number, by: string): Promise<RuleSetVersion> {
    const v = await this.inStatus(series, version, 'in_review');
    if (by === v.submittedBy) throw new RuleSetError('forbidden', 'The one who submitted a rule set cannot publish it (four eyes)');
    if (ruleSetChecksum(v) !== v.checksum) throw new RuleSetError('conflict', 'The content does not match its checksum');
    return this.save({ ...v, status: 'published', publishedBy: by, publishedAt: this.d.clock.now() });
  }

  /** Takes a published version out of use for new assessments. Stored decisions keep their rules. */
  async retire(series: string, version: number, by: string, reason: string): Promise<RuleSetVersion> {
    const v = await this.inStatus(series, version, 'published');
    return this.save({ ...v, status: 'retired', retiredBy: by, retiredAt: this.d.clock.now(), note: this.reason(reason) });
  }

  /** The rules in force in a series on a date, as the claims engine uses them. */
  async rulesInForce(series: string, onDate: ISODate): Promise<ClaimsRules | null> {
    const v = inForce(await this.d.store.list(series), onDate);
    return v ? toClaimsRules(v) : null;
  }

  private async inStatus(series: string, version: number, status: RuleSetStatus): Promise<RuleSetVersion> {
    const v = await this.get(series, version);
    if (v.status !== status) throw new RuleSetError('conflict', `Rule set ${series}@${version} is ${v.status}, not ${status}`);
    return v;
  }

  private async save(v: RuleSetVersion): Promise<RuleSetVersion> {
    const next = { ...v, revision: v.revision + 1 };
    await this.d.store.update(next).catch(this.asConflict);
    return next;
  }

  private reason(reason: string): string {
    const r = reason.trim();
    if (!r) throw new RuleSetError('validation', 'A reason is required');
    return r;
  }

  private asConflict = (e: unknown): never => {
    if (e instanceof RuleSetConflictError) throw new RuleSetError('conflict', e.message);
    throw e;
  };

  private validate(input: DraftInput): void {
    const fail = (m: string): never => {
      throw new RuleSetError('validation', m);
    };
    const c = input.content;
    if (!this.d.calculationModels.includes(input.calculationModel)) fail(`Unknown calculation model '${input.calculationModel}'`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom) || Number.isNaN(Date.parse(input.effectiveFrom))) fail('effectiveFrom must be a date');
    if (!/^[A-Z]{2}$/.test(c.market)) fail(`Invalid market '${c.market}'`);
    if (typeof c.vatReimbursable !== 'boolean') fail('vatReimbursable must be true or false');
    if (!Number.isSafeInteger(c.autoSettleMax) || c.autoSettleMax < 0) fail('autoSettleMax must be a non-negative integer');
    if (!Array.isArray(c.nonReimbursableCategories) || c.nonReimbursableCategories.some((x) => typeof x !== 'string' || !x)) {
      fail('nonReimbursableCategories must be a list of categories');
    }
    for (const [code, group] of Object.entries(c.diagnosisGroups ?? {})) {
      if (!code || typeof group !== 'string' || !group) fail(`Diagnosis code '${code}' needs a group`);
    }
    const known = new Set(['market', 'vatReimbursable', 'nonReimbursableCategories', 'diagnosisGroups', 'autoSettleMax']);
    for (const k of Object.keys(c)) if (!known.has(k)) fail(`Unknown field '${k}' in the rule set`);
  }
}

/**
 * The claims engine's RulesPort, reading published rule sets. Until the
 * product catalog exists, `seriesFor` maps a product version to its series.
 */
export class DecisioningRulesPort implements RulesPort {
  constructor(
    private readonly service: DecisioningService,
    private readonly seriesFor: (productVersion: string) => string,
  ) {}

  getRules(productVersion: string, onDate: ISODate): Promise<ClaimsRules | null> {
    return this.service.rulesInForce(this.seriesFor(productVersion), onDate);
  }
}

/** In-memory store, for tests and the dev server without a database. */
export class InMemoryRuleSetStore implements RuleSetStore {
  private rows: RuleSetVersion[] = [];

  async list(series: string) {
    return structuredClone(this.rows.filter((r) => r.series === series).sort((a, b) => a.version - b.version));
  }

  async get(series: string, version: number) {
    const r = this.rows.find((x) => x.series === series && x.version === version);
    return r ? structuredClone(r) : null;
  }

  async create(v: RuleSetVersion) {
    const last = Math.max(0, ...this.rows.filter((r) => r.series === v.series).map((r) => r.version));
    if (v.version !== last + 1) throw new RuleSetConflictError(`Expected version ${last + 1} in ${v.series}, got ${v.version}`);
    this.rows.push(structuredClone(v));
  }

  async update(v: RuleSetVersion) {
    const i = this.rows.findIndex((r) => r.series === v.series && r.version === v.version);
    const cur = this.rows[i];
    if (!cur || cur.revision !== v.revision - 1) throw new RuleSetConflictError(`Rule set ${v.series}@${v.version} has changed`);
    if (cur.status === 'published' && (v.status !== 'retired' || canonicalJson(cur.content) !== canonicalJson(v.content))) {
      throw new Error(`A published rule set can only be retired`);
    }
    if (
      v.status === 'published' &&
      this.rows.some((r) => r.series === v.series && r.version !== v.version && r.status === 'published' && r.effectiveFrom === v.effectiveFrom)
    ) {
      throw new RuleSetConflictError(`Another published version of ${v.series} applies from ${v.effectiveFrom}`);
    }
    this.rows[i] = structuredClone(v);
  }
}
