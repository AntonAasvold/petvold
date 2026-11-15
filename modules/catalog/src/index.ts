/**
 * The product catalog (ADR 0021, 0022). This part: reference data.
 *
 * Reference data are the code lists other modules point at: species, breeds
 * and sexes. Each item has a stable code, labels per language and an active
 * flag. A code is never deleted or renamed, since stored animals and policies
 * point at it; it is deactivated instead. Every change is a new revision, so
 * the history shows who changed what and when.
 */

export const REFERENCE_KINDS = ['species', 'breed', 'sex'] as const;
export type ReferenceKind = (typeof REFERENCE_KINDS)[number];

/** The kind a kind's parent must be. Breeds belong to a species. */
const PARENT_KIND: Partial<Record<ReferenceKind, ReferenceKind>> = { breed: 'species' };

/** Language tag -> label, e.g. { en: 'Dog', sv: 'Hund' }. */
export type Labels = Record<string, string>;

export interface ReferenceItem {
  kind: ReferenceKind;
  code: string;
  /** The parent's code, e.g. the species of a breed. Never changes. */
  parent?: string;
  labels: Labels;
  /** Inactive codes stay readable for stored data but are not offered for new data. */
  active: boolean;
  /** 1 for the first revision, then +1 per change. */
  revision: number;
  changedBy: string;
  changedAt: string;
  reason?: string;
}

export interface ReferenceDataStore {
  /** The latest revision of every code of a kind, ordered by code. */
  list(kind: ReferenceKind): Promise<ReferenceItem[]>;
  get(kind: ReferenceKind, code: string): Promise<ReferenceItem | null>;
  /** All revisions of a code, oldest first. */
  history(kind: ReferenceKind, code: string): Promise<ReferenceItem[]>;
  /** Stores a new revision. Throws ReferenceConflictError unless it is the next revision of the code. */
  append(item: ReferenceItem): Promise<void>;
}

export class ReferenceConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReferenceConflictError';
  }
}

export type CatalogErrorCode = 'not_found' | 'validation' | 'conflict';

export class CatalogError extends Error {
  constructor(
    public readonly code: CatalogErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CatalogError';
  }
}

export interface ReferenceItemChange {
  labels: Labels;
  parent?: string;
  /** Default true. */
  active?: boolean;
  /** The revision the change is based on. Omitted when the code is new. */
  basedOnRevision?: number;
  reason?: string;
}

export interface CatalogDeps {
  references: ReferenceDataStore;
  clock: { now(): string };
}

const CODE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const LANGUAGE_TAG = /^[a-z]{2,3}(-[A-Z]{2})?$/;

export function isReferenceKind(value: string): value is ReferenceKind {
  return (REFERENCE_KINDS as readonly string[]).includes(value);
}

/**
 * The label for the caller's languages (an Accept-Language header): an exact
 * tag, then the language without region, then English, then the first tag in
 * alphabetical order. Pure.
 */
export function labelFor(labels: Labels, acceptLanguage: string | undefined): string {
  const tags = Object.keys(labels).sort();
  const wanted = (acceptLanguage ?? '')
    .split(',')
    .map((p) => p.trim().split(';')[0]!.trim())
    .filter((t) => t && t !== '*');
  for (const w of wanted) {
    const exact = tags.find((t) => t.toLowerCase() === w.toLowerCase());
    if (exact) return labels[exact]!;
    const lang = w.slice(0, w.indexOf('-') === -1 ? undefined : w.indexOf('-')).toLowerCase();
    const near = tags.find((t) => t === lang) ?? tags.find((t) => t.startsWith(`${lang}-`));
    if (near) return labels[near]!;
  }
  return labels.en ?? labels[tags[0]!] ?? '';
}

export class CatalogService {
  constructor(private readonly d: CatalogDeps) {}

  /** The codes of a kind. With `parent`, only its children, e.g. the breeds of a species. */
  async listReferences(kind: string, filter: { parent?: string; active?: boolean } = {}): Promise<ReferenceItem[]> {
    const items = await this.d.references.list(this.kind(kind));
    return items.filter((i) => (filter.parent === undefined || i.parent === filter.parent) && (filter.active === undefined || i.active === filter.active));
  }

  async getReference(kind: string, code: string): Promise<ReferenceItem> {
    const item = await this.d.references.get(this.kind(kind), code);
    if (!item) throw new CatalogError('not_found', `${kind} '${code}' does not exist`);
    return item;
  }

  async referenceHistory(kind: string, code: string): Promise<ReferenceItem[]> {
    const items = await this.d.references.history(this.kind(kind), code);
    if (items.length === 0) throw new CatalogError('not_found', `${kind} '${code}' does not exist`);
    return items;
  }

  /**
   * Creates a code or stores a new revision of it. Repeating a change that is
   * already stored returns the stored revision, so a retry is safe.
   */
  async putReference(kind: string, code: string, change: ReferenceItemChange, by: string): Promise<{ item: ReferenceItem; created: boolean }> {
    const k = this.kind(kind);
    if (!CODE.test(code)) throw new CatalogError('validation', `Invalid code '${code}': lower-case letters, digits and hyphens`);
    const labels = this.labels(change.labels);
    const active = change.active ?? true;
    const reason = change.reason?.trim() || undefined;
    const history = await this.d.references.history(k, code);
    const current = history.at(-1);
    const based = change.basedOnRevision ?? 0;
    const same = (i: ReferenceItem) => sameContent(i, { labels, active, parent: change.parent ?? i.parent });

    // A retry of a change already stored: the revision after `based` has the same content.
    const retried = history.find((i) => i.revision === based + 1);
    if (retried && retried === current && same(retried) && (change.parent === undefined || change.parent === retried.parent)) {
      return { item: retried, created: false };
    }
    if ((current?.revision ?? 0) !== based) {
      throw new CatalogError(
        'conflict',
        current ? `${k} '${code}' is at revision ${current.revision}, not ${based}` : `${k} '${code}' does not exist, omit basedOnRevision`,
      );
    }
    if (current && same(current) && (change.parent === undefined || change.parent === current.parent)) return { item: current, created: false };

    const parent = current ? current.parent : await this.parent(k, change.parent);
    if (current && change.parent !== undefined && change.parent !== current.parent) {
      throw new CatalogError('validation', `The parent of ${k} '${code}' cannot change`);
    }
    if (current && !reason) throw new CatalogError('validation', 'A reason is required to change an existing code');

    const item: ReferenceItem = {
      kind: k,
      code,
      ...(parent ? { parent } : {}),
      labels,
      active,
      revision: based + 1,
      changedBy: by,
      changedAt: this.d.clock.now(),
      ...(reason ? { reason } : {}),
    };
    await this.d.references.append(item).catch((e: unknown) => {
      if (e instanceof ReferenceConflictError) throw new CatalogError('conflict', e.message);
      throw e;
    });
    return { item, created: !current };
  }

  private kind(kind: string): ReferenceKind {
    if (!isReferenceKind(kind)) throw new CatalogError('not_found', `Unknown kind of reference data '${kind}'`);
    return kind;
  }

  private async parent(kind: ReferenceKind, parent: string | undefined): Promise<string | undefined> {
    const parentKind = PARENT_KIND[kind];
    if (!parentKind) {
      if (parent !== undefined) throw new CatalogError('validation', `A ${kind} has no parent`);
      return undefined;
    }
    if (parent === undefined) throw new CatalogError('validation', `A ${kind} needs a parent ${parentKind}`);
    const p = await this.d.references.get(parentKind, parent);
    if (!p) throw new CatalogError('validation', `The ${parentKind} '${parent}' does not exist`);
    if (!p.active) throw new CatalogError('validation', `The ${parentKind} '${parent}' is not active`);
    return parent;
  }

  private labels(labels: Labels): Labels {
    const entries = Object.entries(labels ?? {});
    if (entries.length === 0) throw new CatalogError('validation', 'At least one label is required');
    const out: Labels = {};
    for (const [tag, label] of entries) {
      if (!LANGUAGE_TAG.test(tag)) throw new CatalogError('validation', `Invalid language tag '${tag}', e.g. 'sv' or 'de-CH'`);
      const l = typeof label === 'string' ? label.trim() : '';
      if (!l || l.length > 200) throw new CatalogError('validation', `The label for '${tag}' must be 1-200 characters`);
      out[tag] = l;
    }
    return out;
  }
}

function sameContent(i: ReferenceItem, c: { labels: Labels; active: boolean; parent?: string }): boolean {
  const a = Object.entries(i.labels).sort(([x], [y]) => x.localeCompare(y));
  const b = Object.entries(c.labels).sort(([x], [y]) => x.localeCompare(y));
  return i.active === c.active && i.parent === c.parent && JSON.stringify(a) === JSON.stringify(b);
}

/** In-memory store, for tests and the dev server without a database. */
export class InMemoryReferenceDataStore implements ReferenceDataStore {
  private rows: ReferenceItem[] = [];

  async list(kind: ReferenceKind) {
    const latest = new Map<string, ReferenceItem>();
    for (const r of this.rows) if (r.kind === kind && (latest.get(r.code)?.revision ?? 0) < r.revision) latest.set(r.code, r);
    return structuredClone([...latest.values()].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0)));
  }

  async get(kind: ReferenceKind, code: string) {
    return (await this.history(kind, code)).at(-1) ?? null;
  }

  async history(kind: ReferenceKind, code: string) {
    return structuredClone(this.rows.filter((r) => r.kind === kind && r.code === code).sort((a, b) => a.revision - b.revision));
  }

  async append(item: ReferenceItem) {
    const last = (await this.get(item.kind, item.code))?.revision ?? 0;
    if (item.revision !== last + 1) throw new ReferenceConflictError(`Expected revision ${last + 1} of ${item.kind} '${item.code}', got ${item.revision}`);
    this.rows.push(structuredClone(item));
  }
}
