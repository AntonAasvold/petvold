/**
 * Products and product versions (ADR 0021, 0023).
 *
 * A product version (e.g. 'SE-HUND-VV-LIV@2026.2') says what can be sold: the
 * market, currency and species, the sales period, the rule series the claims
 * engine assesses with, and the options a customer chooses between (annual
 * limit, deductible). Lifecycle: draft -> in_review -> published. Publishing
 * needs someone other than the submitter. A published version never changes,
 * except that its sales can be ended earlier, with a reason.
 */
import { canonicalJson, sha256, type DeductibleTerms, type ISODate, type MinorUnits, type VetCareTerms } from '@petvold/claims-core';
import { CatalogError } from './errors.ts';

/** Language tag -> label. */
type Labels = Record<string, string>;

export type ProductStatus = 'draft' | 'in_review' | 'published';

export interface DeductibleOption {
  /** Stable code of the option, e.g. 'standard' or 'high'. */
  code: string;
  labels: Labels;
  terms: DeductibleTerms;
}

/** Vet care: the options a customer chooses between, and fixed terms. */
export interface VetCareCover {
  /** Annual limits to choose from, in the product's currency. */
  annualLimits: MinorUnits[];
  defaultAnnualLimit: MinorUnits;
  deductibles: DeductibleOption[];
  defaultDeductible: string;
  waitingPeriodDays: number;
}

/** What an author writes, and what review and publication lock. */
export interface ProductContent {
  market: string;
  currency: string;
  /** Species codes from the reference data. */
  species: string[];
  names: Labels;
  /** The rule series the claims engine assesses claims on this version with (ADR 0021). */
  ruleSeries: string;
  vetCare: VetCareCover;
}

export interface ProductVersion {
  product: string;
  version: string;
  status: ProductStatus;
  content: ProductContent;
  /** First day of sales. */
  salesFrom: ISODate;
  /** First day it is no longer sold (exclusive). Omitted: until further notice. Can be brought forward after publication. */
  salesTo?: ISODate;
  /** sha256 over content and salesFrom. Set when submitted for review. */
  checksum?: string;
  revision: number;
  createdBy: string;
  createdAt: string;
  submittedBy?: string;
  submittedAt?: string;
  publishedBy?: string;
  publishedAt?: string;
  salesEndedBy?: string;
  salesEndedAt?: string;
  /** Why it was returned to draft, or why sales ended. */
  note?: string;
}

export interface ProductStore {
  /** All versions of a product, ordered by salesFrom, then version. */
  list(product: string): Promise<ProductVersion[]>;
  get(product: string, version: string): Promise<ProductVersion | null>;
  /** Published versions of every product. */
  published(): Promise<ProductVersion[]>;
  /** Throws ProductConflictError if the version exists. */
  create(v: ProductVersion): Promise<void>;
  /** Throws ProductConflictError unless the stored revision is `v.revision - 1`. */
  update(v: ProductVersion): Promise<void>;
}

export class ProductConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProductConflictError';
  }
}

export interface ProductDraft {
  version: string;
  content: ProductContent;
  salesFrom: ISODate;
  salesTo?: ISODate;
}

export interface ProductDeps {
  products: ProductStore;
  clock: { now(): string };
  /** Whether a species code exists and is active (the catalog's own reference data). */
  speciesActive(code: string): Promise<boolean>;
  /**
   * Whether the rule series has a published version in force on the date.
   * Given by the installation, which asks the decisioning module (ADR 0001).
   */
  ruleSeriesInForce(series: string, onDate: ISODate): Promise<boolean>;
}

export const productVersionId = (v: Pick<ProductVersion, 'product' | 'version'>) => `${v.product}@${v.version}`;

export function productChecksum(v: Pick<ProductVersion, 'content' | 'salesFrom'>): string {
  return sha256({ content: v.content, salesFrom: v.salesFrom });
}

/** Whether a version is on sale on a date. */
export function onSale(v: ProductVersion, date: ISODate): boolean {
  return v.status === 'published' && v.salesFrom <= date && (!v.salesTo || date < v.salesTo);
}

/**
 * The vet care terms for a customer's choices, defaults where nothing is
 * chosen. The policy gets these when it is written (M3). Pure.
 */
export function vetCareTermsFor(v: ProductVersion, choice: { annualLimit?: MinorUnits; deductible?: string } = {}): VetCareTerms {
  const c = v.content.vetCare;
  const annualLimit = choice.annualLimit ?? c.defaultAnnualLimit;
  if (!c.annualLimits.includes(annualLimit)) {
    throw new CatalogError('validation', `${productVersionId(v)} has no annual limit ${annualLimit}`);
  }
  const code = choice.deductible ?? c.defaultDeductible;
  const d = c.deductibles.find((x) => x.code === code);
  if (!d) throw new CatalogError('validation', `${productVersionId(v)} has no deductible '${code}'`);
  return { code: 'vet_care', annualLimit, deductible: structuredClone(d.terms), waitingPeriodDays: c.waitingPeriodDays };
}

const PRODUCT = /^[A-Z0-9][A-Z0-9-]{1,63}$/;
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.-]{0,31}$/;
const OPTION = /^[a-z0-9][a-z0-9-]{0,31}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (s: unknown) => typeof s === 'string' && DATE.test(s) && !Number.isNaN(Date.parse(s));
const isAmount = (n: unknown) => Number.isSafeInteger(n) && (n as number) >= 0;

export class ProductService {
  constructor(private readonly d: ProductDeps) {}

  list(product: string): Promise<ProductVersion[]> {
    return this.d.products.list(product);
  }

  async get(product: string, version: string): Promise<ProductVersion> {
    const v = await this.d.products.get(product, version);
    if (!v) throw new CatalogError('not_found', `Product version ${product}@${version} does not exist`);
    return v;
  }

  /** Published versions on sale on a date, optionally for one market and species. */
  async onSale(date: ISODate, filter: { market?: string; species?: string } = {}): Promise<ProductVersion[]> {
    if (!isDate(date)) throw new CatalogError('validation', 'The date must be YYYY-MM-DD');
    return (await this.d.products.published()).filter(
      (v) =>
        onSale(v, date) &&
        (!filter.market || v.content.market === filter.market) &&
        (!filter.species || v.content.species.includes(filter.species)),
    );
  }

  /** The rule series of a published version, e.g. for the claims engine. null if there is none. */
  async ruleSeriesOf(productVersion: string): Promise<string | null> {
    const at = productVersion.lastIndexOf('@');
    if (at < 1) return null;
    const v = await this.d.products.get(productVersion.slice(0, at), productVersion.slice(at + 1));
    return v?.status === 'published' ? v.content.ruleSeries : null;
  }

  async createDraft(product: string, draft: ProductDraft, by: string): Promise<ProductVersion> {
    if (!PRODUCT.test(product)) throw new CatalogError('validation', `Invalid product '${product}': capital letters, digits and hyphens`);
    if (!VERSION.test(draft.version ?? '')) throw new CatalogError('validation', `Invalid version '${draft.version}', e.g. 2026.2`);
    this.validate(draft);
    const v: ProductVersion = {
      product,
      version: draft.version,
      status: 'draft',
      content: draft.content,
      salesFrom: draft.salesFrom,
      ...(draft.salesTo ? { salesTo: draft.salesTo } : {}),
      revision: 1,
      createdBy: by,
      createdAt: this.d.clock.now(),
    };
    await this.d.products.create(v).catch(this.asConflict);
    return v;
  }

  async updateDraft(product: string, version: string, draft: Omit<ProductDraft, 'version'>): Promise<ProductVersion> {
    const v = await this.inStatus(product, version, 'draft');
    this.validate(draft);
    const { salesTo: _t, ...rest } = v;
    return this.save({ ...rest, content: draft.content, salesFrom: draft.salesFrom, ...(draft.salesTo ? { salesTo: draft.salesTo } : {}) });
  }

  /** Locks the content for review. Species must be active and the rule series in force when sales start. */
  async submit(product: string, version: string, by: string): Promise<ProductVersion> {
    const v = await this.inStatus(product, version, 'draft');
    await this.checkReferences(v);
    const { note: _n, ...rest } = v;
    return this.save({ ...rest, status: 'in_review', checksum: productChecksum(v), submittedBy: by, submittedAt: this.d.clock.now() });
  }

  async returnToDraft(product: string, version: string, reason: string): Promise<ProductVersion> {
    const v = await this.inStatus(product, version, 'in_review');
    const { checksum: _c, submittedBy: _s, submittedAt: _a, ...rest } = v;
    return this.save({ ...rest, status: 'draft', note: this.reason(reason) });
  }

  /** Publishes a version in review. Someone other than the submitter (four eyes). One version of a product on sale per day. */
  async publish(product: string, version: string, by: string): Promise<ProductVersion> {
    const v = await this.inStatus(product, version, 'in_review');
    if (by === v.submittedBy) throw new CatalogError('forbidden', 'The one who submitted a product version cannot publish it (four eyes)');
    if (productChecksum(v) !== v.checksum) throw new CatalogError('conflict', 'The content does not match its checksum');
    await this.checkReferences(v);
    const clash = (await this.d.products.list(product)).find((o) => o.status === 'published' && overlaps(o, v));
    if (clash) throw new CatalogError('conflict', `${productVersionId(clash)} is on sale in the same period`);
    return this.save({ ...v, status: 'published', publishedBy: by, publishedAt: this.d.clock.now() });
  }

  /** Brings the end of sales forward, never back and never before today. Policies already written keep the version. */
  async endSales(product: string, version: string, salesTo: ISODate, by: string, reason: string): Promise<ProductVersion> {
    const v = await this.inStatus(product, version, 'published');
    if (!isDate(salesTo)) throw new CatalogError('validation', 'salesTo must be YYYY-MM-DD');
    const today = this.d.clock.now().slice(0, 10);
    if (salesTo < today) throw new CatalogError('validation', `Sales cannot end before today (${today})`);
    if (salesTo < v.salesFrom) throw new CatalogError('validation', 'Sales cannot end before they start');
    if (v.salesTo && salesTo >= v.salesTo) throw new CatalogError('validation', `Sales already end ${v.salesTo}; they can only be brought forward`);
    return this.save({ ...v, salesTo, salesEndedBy: by, salesEndedAt: this.d.clock.now(), note: this.reason(reason) });
  }

  private async checkReferences(v: ProductVersion): Promise<void> {
    for (const s of v.content.species) {
      if (!(await this.d.speciesActive(s))) throw new CatalogError('validation', `The species '${s}' does not exist or is not active`);
    }
    if (!(await this.d.ruleSeriesInForce(v.content.ruleSeries, v.salesFrom))) {
      throw new CatalogError('validation', `The rule series ${v.content.ruleSeries} has no published version in force on ${v.salesFrom}`);
    }
  }

  private async inStatus(product: string, version: string, status: ProductStatus): Promise<ProductVersion> {
    const v = await this.get(product, version);
    if (v.status !== status) throw new CatalogError('conflict', `Product version ${product}@${version} is ${v.status}, not ${status}`);
    return v;
  }

  private async save(v: ProductVersion): Promise<ProductVersion> {
    const next = { ...v, revision: v.revision + 1 };
    await this.d.products.update(next).catch(this.asConflict);
    return next;
  }

  private reason(reason: string): string {
    const r = (reason ?? '').trim();
    if (!r) throw new CatalogError('validation', 'A reason is required');
    return r;
  }

  private asConflict = (e: unknown): never => {
    if (e instanceof ProductConflictError) throw new CatalogError('conflict', e.message);
    throw e;
  };

  private validate(d: Omit<ProductDraft, 'version'>): void {
    const fail = (m: string): never => {
      throw new CatalogError('validation', m);
    };
    const c = d.content;
    if (!isDate(d.salesFrom)) fail('salesFrom must be YYYY-MM-DD');
    if (d.salesTo !== undefined && (!isDate(d.salesTo) || d.salesTo <= d.salesFrom)) fail('salesTo must be a date after salesFrom');
    if (!/^[A-Z]{2}$/.test(c.market)) fail(`Invalid market '${c.market}'`);
    if (!/^[A-Z]{3}$/.test(c.currency)) fail(`Invalid currency '${c.currency}'`);
    if (!Array.isArray(c.species) || c.species.length === 0) fail('At least one species is required');
    if (new Set(c.species).size !== c.species.length) fail('A species is listed twice');
    if (!c.names || Object.keys(c.names).length === 0) fail('The product needs a name');
    if (!PRODUCT.test(c.ruleSeries ?? '')) fail(`Invalid rule series '${c.ruleSeries}'`);
    const vc = c.vetCare;
    if (!vc) return fail('vetCare is required');
    if (!Array.isArray(vc.annualLimits) || vc.annualLimits.length === 0 || !vc.annualLimits.every(isAmount)) {
      fail('annualLimits must be a non-empty list of non-negative integers');
    }
    if (new Set(vc.annualLimits).size !== vc.annualLimits.length) fail('An annual limit is listed twice');
    if (!vc.annualLimits.includes(vc.defaultAnnualLimit)) fail('defaultAnnualLimit must be one of annualLimits');
    if (!Number.isSafeInteger(vc.waitingPeriodDays) || vc.waitingPeriodDays < 0 || vc.waitingPeriodDays > 365) {
      fail('waitingPeriodDays must be 0-365');
    }
    if (!Array.isArray(vc.deductibles) || vc.deductibles.length === 0) fail('At least one deductible option is required');
    const codes = new Set<string>();
    for (const o of vc.deductibles) {
      if (!OPTION.test(o.code ?? '')) fail(`Invalid deductible option code '${o.code}'`);
      if (codes.has(o.code)) fail(`The deductible option '${o.code}' is listed twice`);
      codes.add(o.code);
      if (!o.labels || Object.keys(o.labels).length === 0) fail(`The deductible option '${o.code}' needs a label`);
      validateDeductible(o.code, o.terms, fail);
    }
    if (!codes.has(vc.defaultDeductible)) fail('defaultDeductible must be one of the deductible options');
  }
}

function validateDeductible(code: string, t: DeductibleTerms, fail: (m: string) => never): void {
  const at = `Deductible '${code}'`;
  if (!t) fail(`${at} needs terms`);
  if (!isAmount(t.fixed)) fail(`${at}: fixed must be a non-negative integer`);
  if (!['period', 'claim', 'policy_year'].includes(t.fixedPer)) fail(`${at}: fixedPer must be period, claim or policy_year`);
  if (t.fixedPer === 'period' && (!Number.isSafeInteger(t.periodDays) || t.periodDays! < 1 || t.periodDays! > 3650)) {
    fail(`${at}: periodDays 1-3650 is required when fixedPer is period`);
  }
  if (t.fixedPer !== 'period' && (t.periodDays !== undefined || t.periodEndsAtRenewal !== undefined)) {
    fail(`${at}: periodDays and periodEndsAtRenewal apply only when fixedPer is period`);
  }
  const bp = (n: unknown) => Number.isSafeInteger(n) && (n as number) >= 0 && (n as number) <= 10_000;
  if (!bp(t.variableBp)) fail(`${at}: variableBp must be 0-10000`);
  for (const s of t.variableBpByAge ?? []) {
    if (!Number.isSafeInteger(s.fromAgeYears) || s.fromAgeYears < 1 || !bp(s.bp)) fail(`${at}: invalid age step`);
  }
}

/** Whether two versions' sales periods share a day. */
function overlaps(a: ProductVersion, b: ProductVersion): boolean {
  return a.version !== b.version && (!a.salesTo || b.salesFrom < a.salesTo) && (!b.salesTo || a.salesFrom < b.salesTo);
}

/** In-memory store, for tests and the dev server without a database. */
export class InMemoryProductStore implements ProductStore {
  private rows: ProductVersion[] = [];

  async list(product: string) {
    return structuredClone(this.rows.filter((r) => r.product === product).sort(bySales));
  }

  async get(product: string, version: string) {
    const r = this.rows.find((x) => x.product === product && x.version === version);
    return r ? structuredClone(r) : null;
  }

  async published() {
    return structuredClone(this.rows.filter((r) => r.status === 'published').sort((a, b) => (a.product < b.product ? -1 : a.product > b.product ? 1 : bySales(a, b))));
  }

  async create(v: ProductVersion) {
    if (this.rows.some((r) => r.product === v.product && r.version === v.version)) throw new ProductConflictError(`${productVersionId(v)} already exists`);
    this.rows.push(structuredClone(v));
  }

  async update(v: ProductVersion) {
    const i = this.rows.findIndex((r) => r.product === v.product && r.version === v.version);
    const cur = this.rows[i];
    if (!cur || cur.revision !== v.revision - 1) throw new ProductConflictError(`${productVersionId(v)} has changed`);
    if (cur.status === 'published' && (canonicalJson(cur.content) !== canonicalJson(v.content) || cur.salesFrom !== v.salesFrom || v.status !== 'published')) {
      throw new Error('A published product version can only have its sales ended');
    }
    if (cur.status === 'published' && v.salesTo !== cur.salesTo && (!v.salesTo || (cur.salesTo && v.salesTo >= cur.salesTo))) {
      throw new Error('Sales can only be brought forward');
    }
    if (v.status === 'published' && this.rows.some((r) => r.product === v.product && r.status === 'published' && overlaps(r, v))) {
      throw new Error(`Another version of ${v.product} is on sale in the same period`);
    }
    this.rows[i] = structuredClone(v);
  }
}

function bySales(a: ProductVersion, b: ProductVersion): number {
  return a.salesFrom < b.salesFrom ? -1 : a.salesFrom > b.salesFrom ? 1 : a.version < b.version ? -1 : a.version > b.version ? 1 : 0;
}
