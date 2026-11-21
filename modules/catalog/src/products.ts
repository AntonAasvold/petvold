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
import { marketDate, marketLanguage } from '@petvold/common';
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

/** How the product's policies behave over time (ADR 0029). Each has a default. */
export interface PolicySettings {
  /**
   * The customer's cancellation during a term: 'term-end' keeps the term (the
   * binding period) and ends the policy when it runs out; 'immediate' ends it
   * the day after notice and refunds the rest of the premium. Cancelling when
   * the need for insurance ceases, and withdrawal, are always allowed.
   * Default 'term-end'.
   */
  midTermCancellation?: 'term-end' | 'immediate';
  /**
   * The length of a term in months, at issue and at each renewal. Default 12.
   * The market's law sets the maximum (Sweden: 12, FAL 3 kap. 2 §); the policy
   * module checks it.
   */
  termMonths?: number;
  /**
   * Days before the term ends that the renewal run renews it. Default 45. Must
   * be shorter than the term. If the price or terms change at renewal, the
   * customer should hear of it more than a month before the term ends.
   */
  renewalLeadDays?: number;
  /** Days a new owner has to accept a transferred policy. Default 30. */
  transferAcceptanceDays?: number;
  /** Days an application referred to a person may wait before it expires (ADR 0031). Default 30. */
  applicationExpiryDays?: number;
  /**
   * How many days after the day of issue a new policy may start, 0-365. Default
   * 90. The price and the underwriting are set on the day of issue, so a start
   * far ahead would lock them for long.
   */
  maxStartAheadDays?: number;
}

/** How often the premium is paid (ADR 0040). */
export const PAYMENT_INTERVALS = ['year', 'half-year', 'quarter', 'month'] as const;
export type PaymentInterval = (typeof PAYMENT_INTERVALS)[number];

/** How the product's premium is paid (ADR 0040). */
export interface BillingSettings {
  /** The intervals a customer may choose. Default ['year']. */
  paymentIntervals?: PaymentInterval[];
  /** The interval when none is chosen. One of paymentIntervals. Default 'year'. */
  defaultPaymentInterval?: PaymentInterval;
  /** A fee per installment in minor units, taken only when the interval is shorter than a year. Default 0. */
  installmentFee?: number;
  /** Days before an installment is due that it goes on an invoice. Default 31: a month is never longer, so a later premium can be due on its day a month after the invoice (FAL 5 kap. 1 §). */
  invoiceLeadDays?: number;
}

export const BILLING_SETTING_DEFAULTS: Required<BillingSettings> = { paymentIntervals: ['year'], defaultPaymentInterval: 'year', installmentFee: 0, invoiceLeadDays: 31 };

/** The product's billing settings with defaults filled in. Pure. */
export function billingSettingsOf(c: ProductContent): Required<BillingSettings> {
  return { ...BILLING_SETTING_DEFAULTS, ...structuredClone(c.billing ?? {}) };
}

export const POLICY_SETTING_DEFAULTS: Required<PolicySettings> = { midTermCancellation: 'term-end', termMonths: 12, renewalLeadDays: 45, transferAcceptanceDays: 30, applicationExpiryDays: 30, maxStartAheadDays: 90 };

/** The product's policy settings with defaults filled in. Pure. */
export function policySettingsOf(c: ProductContent): Required<PolicySettings> {
  return { ...POLICY_SETTING_DEFAULTS, ...(c.policy ?? {}) };
}

/** The documents a customer is shown before buying (ADR 0032). */
export const PRODUCT_DOCUMENT_TYPES = ['terms', 'pre-contract', 'ipid'] as const;
export type ProductDocumentType = (typeof PRODUCT_DOCUMENT_TYPES)[number];

/**
 * A document of a product version, kept in the insurer's archive (ADR 0032).
 * Petvold holds the address and the checksum, not the document, so a customer's
 * acceptance can say exactly which document they were shown.
 */
export interface ProductDocument {
  /** terms: the full terms; pre-contract: information before the contract; ipid: the product information document (IDD art. 20). */
  type: ProductDocumentType;
  /** ISO 639-1, e.g. 'sv'. */
  language: string;
  /** Where the insurer's archive keeps it, e.g. https://documents.example.com/terms-sv.pdf. */
  uri: string;
  /** sha256 of the document's bytes, lowercase hex. */
  sha256: string;
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
  /** The tariff series that prices it (ADR 0030). Omitted: the premium is given by hand. */
  tariffSeries?: string;
  /** The price terms series: discounts after the base price (ADR 0030). Only with a tariff series. */
  priceTermsSeries?: string;
  /** The underwriting rules series for new policies (ADR 0031). Omitted: every application is accepted. */
  underwritingSeries?: string;
  vetCare: VetCareCover;
  policy?: PolicySettings;
  /** How the premium is paid (ADR 0040). */
  billing?: BillingSettings;
  /**
   * The documents per type and language (ADR 0032). Locked with the content at
   * review. Omitted: the product has none in Petvold and acceptance names none.
   */
  documents?: ProductDocument[];
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
  /** Every product's name, sorted. */
  productNames(): Promise<string[]>;
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
  /**
   * What the tariff in force on the date cannot price for the product, e.g. an
   * annual limit it lacks (ADR 0030). null: no tariff in force. Omitted: tariff
   * series are not checked.
   */
  tariffProblems?(
    series: string,
    onDate: ISODate,
    product: { market: string; currency: string; species: string[]; annualLimits: number[]; deductibleOptions: string[] },
  ): Promise<string[] | null>;
  /** What is wrong with the price terms in force on the date for the product. null: none in force. */
  priceTermsProblems?(series: string, onDate: ISODate, product: { market: string; currency: string }): Promise<string[] | null>;
  /**
   * What the underwriting rules in force on the date cannot decide for the
   * product, e.g. a species without age limits (ADR 0031). null: none in force.
   * Omitted: underwriting series are not checked.
   */
  underwritingProblems?(series: string, onDate: ISODate, product: { market: string; species: string[] }): Promise<string[] | null>;
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
  /** Every product with its versions, newest last: for a list of products. */
  async allProducts(): Promise<{ product: string; versions: ProductVersion[] }[]> {
    return Promise.all((await this.d.products.productNames()).map(async (product) => ({ product, versions: await this.d.products.list(product) })));
  }

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
    const today = marketDate(v.content.market, this.d.clock.now());
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
    const tariff = v.content.tariffSeries;
    if (tariff && this.d.tariffProblems) {
      const c = v.content;
      const problems = await this.d.tariffProblems(tariff, v.salesFrom, {
        market: c.market,
        currency: c.currency,
        species: c.species,
        annualLimits: c.vetCare.annualLimits,
        deductibleOptions: c.vetCare.deductibles.map((d) => d.code),
      });
      if (problems === null) throw new CatalogError('validation', `The tariff series ${tariff} has no published version in force on ${v.salesFrom}`);
      if (problems.length) throw new CatalogError('validation', `The tariff series ${tariff} does not cover the product: ${problems.join('; ')}`);
    }
    const terms = v.content.priceTermsSeries;
    if (terms && this.d.priceTermsProblems) {
      const problems = await this.d.priceTermsProblems(terms, v.salesFrom, { market: v.content.market, currency: v.content.currency });
      if (problems === null) throw new CatalogError('validation', `The price terms series ${terms} has no published version in force on ${v.salesFrom}`);
      if (problems.length) throw new CatalogError('validation', `The price terms series ${terms} does not fit the product: ${problems.join('; ')}`);
    }
    const uw = v.content.underwritingSeries;
    if (uw && this.d.underwritingProblems) {
      const problems = await this.d.underwritingProblems(uw, v.salesFrom, { market: v.content.market, species: v.content.species });
      if (problems === null) throw new CatalogError('validation', `The underwriting series ${uw} has no published version in force on ${v.salesFrom}`);
      if (problems.length) throw new CatalogError('validation', `The underwriting series ${uw} does not cover the product: ${problems.join('; ')}`);
    }
    const docs = v.content.documents ?? [];
    const language = marketLanguage(v.content.market);
    if (docs.length && language) {
      const missing = PRODUCT_DOCUMENT_TYPES.filter((t) => !docs.some((d) => d.type === t && d.language === language));
      if (missing.length) throw new CatalogError('validation', `The product's documents lack ${missing.join(', ')} in '${language}', the language of ${v.content.market}`);
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
    if (c.tariffSeries !== undefined && !PRODUCT.test(c.tariffSeries)) fail(`Invalid tariff series '${c.tariffSeries}'`);
    if (c.priceTermsSeries !== undefined && (!PRODUCT.test(c.priceTermsSeries) || !c.tariffSeries)) fail('priceTermsSeries needs a valid series name and a tariffSeries');
    if (c.underwritingSeries !== undefined && !PRODUCT.test(c.underwritingSeries)) fail(`Invalid underwriting series '${c.underwritingSeries}'`);
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
    const ps = c.policy;
    if (ps !== undefined) {
      if (ps.midTermCancellation !== undefined && !['term-end', 'immediate'].includes(ps.midTermCancellation)) {
        fail('policy.midTermCancellation must be term-end or immediate');
      }
      if (ps.termMonths !== undefined && (!Number.isSafeInteger(ps.termMonths) || ps.termMonths < 1 || ps.termMonths > 12)) {
        fail('policy.termMonths must be 1-12');
      }
      const termMonths = ps.termMonths ?? POLICY_SETTING_DEFAULTS.termMonths;
      if (ps.renewalLeadDays !== undefined && (!Number.isSafeInteger(ps.renewalLeadDays) || ps.renewalLeadDays < 1 || ps.renewalLeadDays > 120)) {
        fail('policy.renewalLeadDays must be 1-120');
      }
      if ((ps.renewalLeadDays ?? POLICY_SETTING_DEFAULTS.renewalLeadDays) >= termMonths * 28) {
        fail(`policy.renewalLeadDays must be shorter than a term of ${termMonths} months`);
      }
      if (ps.transferAcceptanceDays !== undefined && (!Number.isSafeInteger(ps.transferAcceptanceDays) || ps.transferAcceptanceDays < 1 || ps.transferAcceptanceDays > 90)) {
        fail('policy.transferAcceptanceDays must be 1-90');
      }
      if (ps.applicationExpiryDays !== undefined && (!Number.isSafeInteger(ps.applicationExpiryDays) || ps.applicationExpiryDays < 1 || ps.applicationExpiryDays > 90)) {
        fail('policy.applicationExpiryDays must be 1-90');
      }
      if (ps.maxStartAheadDays !== undefined && (!Number.isSafeInteger(ps.maxStartAheadDays) || ps.maxStartAheadDays < 0 || ps.maxStartAheadDays > 365)) {
        fail('policy.maxStartAheadDays must be 0-365');
      }
    }
    if (c.billing !== undefined) validateBilling(c.billing, fail);
    if (c.documents !== undefined) validateDocuments(c.documents, fail);
  }
}

function validateBilling(b: BillingSettings, fail: (m: string) => never): void {
  const intervals = b.paymentIntervals ?? BILLING_SETTING_DEFAULTS.paymentIntervals;
  if (!Array.isArray(intervals) || intervals.length === 0 || intervals.some((i) => !PAYMENT_INTERVALS.includes(i))) {
    fail(`billing.paymentIntervals must be one or more of ${PAYMENT_INTERVALS.join(', ')}`);
  }
  if (new Set(intervals).size !== intervals.length) fail('billing.paymentIntervals lists an interval twice');
  const def = b.defaultPaymentInterval ?? BILLING_SETTING_DEFAULTS.defaultPaymentInterval;
  if (!intervals.includes(def)) fail('billing.defaultPaymentInterval must be one of billing.paymentIntervals');
  if (b.installmentFee !== undefined && (!isAmount(b.installmentFee) || b.installmentFee > 100_000)) fail('billing.installmentFee must be 0-100000');
  if (b.invoiceLeadDays !== undefined && (!Number.isSafeInteger(b.invoiceLeadDays) || b.invoiceLeadDays < 1 || b.invoiceLeadDays > 60)) {
    fail('billing.invoiceLeadDays must be 1-60');
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

function validateDocuments(docs: ProductDocument[], fail: (m: string) => never): void {
  if (!Array.isArray(docs)) fail('documents must be a list');
  const seen = new Set<string>();
  for (const d of docs) {
    if (!PRODUCT_DOCUMENT_TYPES.includes(d?.type)) fail(`Invalid document type '${d?.type}', one of ${PRODUCT_DOCUMENT_TYPES.join(', ')}`);
    if (!/^[a-z]{2}$/.test(d.language ?? '')) fail(`The ${d.type} document needs a language in ISO 639-1, e.g. sv`);
    const key = `${d.type}/${d.language}`;
    if (seen.has(key)) fail(`The ${d.type} document in '${d.language}' is listed twice`);
    seen.add(key);
    if (typeof d.uri !== 'string' || d.uri.length > 500 || !/^[a-z][a-z0-9+.-]*:\S+$/.test(d.uri)) fail(`The ${key} document needs an absolute uri`);
    if (!/^[0-9a-f]{64}$/.test(d.sha256 ?? '')) fail(`The ${key} document needs a sha256 checksum in lowercase hex`);
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

  async productNames() {
    return [...new Set(this.rows.map((r) => r.product))].sort();
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
