/**
 * Parties (ADR 0026): the persons and organizations other modules point at,
 * e.g. the owner of an animal or, later, the policyholder.
 *
 * A party has details (name, contact details, address) that change through
 * revisions with a reason, and identifiers (personal or organization numbers)
 * that are unique per country and never removed. Kind and market never change.
 *
 * What a party is to the business (owner, policyholder, payee) is not stored
 * here: the module that has the relation owns it.
 *
 * Personal numbers are personal data that need extra care. They can be stored
 * and searched for, but `publicView` masks them in everything shown.
 */

export type ISODate = string;

export const PARTY_KINDS = ['person', 'organization'] as const;
export type PartyKind = (typeof PARTY_KINDS)[number];

export const PARTY_IDENTIFIER_TYPES = ['personal-number', 'organization-number'] as const;
export type PartyIdentifierType = (typeof PARTY_IDENTIFIER_TYPES)[number];

export interface Address {
  street: string;
  postalCode: string;
  city: string;
  /** ISO 3166-1 alpha-2. */
  country: string;
}

/** The changeable details of a party. Persons have given and family name; organizations have a name. */
export interface PartyDetails {
  givenName?: string;
  familyName?: string;
  /** Persons only. */
  birthDate?: ISODate;
  /** Organizations only. */
  name?: string;
  email?: string;
  /** E.164, e.g. +46701234567. */
  phone?: string;
  address?: Address;
  /** Preferred language for letters and messages, ISO 639-1, e.g. 'sv'. */
  language?: string;
}

/** One revision of a party's details. */
export interface Party extends PartyDetails {
  id: string;
  revision: number;
  kind: PartyKind;
  /** The market the party belongs to. Limits who may see it (ADR 0016). Never changes. */
  market: string;
  changedBy: string;
  changedAt: string;
  /** Why the details changed. Required from revision 2. */
  reason?: string;
}

export interface PartyIdentifier {
  type: PartyIdentifierType;
  /** The country that issued the number, ISO 3166-1 alpha-2. */
  country: string;
  value: string;
  addedBy: string;
  addedAt: string;
}

export interface PartyRecord extends Party {
  identifiers: PartyIdentifier[];
}

/** An identifier as shown: personal numbers are masked (ADR 0026). */
export interface ShownIdentifier {
  type: PartyIdentifierType;
  country: string;
  value: string;
  masked: boolean;
  addedBy: string;
  addedAt: string;
}

export interface PartyView extends Party {
  identifiers: ShownIdentifier[];
}

export interface PartyStore {
  get(id: string): Promise<PartyRecord | null>;
  /** Every revision of the details, oldest first. */
  revisions(id: string): Promise<Party[]>;
  findByIdentifier(type: PartyIdentifierType, country: string, value: string): Promise<string | null>;
  /** Stores a new party with its first revision and identifiers, all or nothing. */
  register(party: Party, identifiers: PartyIdentifier[]): Promise<void>;
  /** Throws PartyConflictError unless it is the next revision. */
  appendRevision(party: Party): Promise<void>;
  /** Throws PartyIdentifierTakenError if any party already has it. */
  addIdentifier(partyId: string, identifier: PartyIdentifier): Promise<void>;
}

export class PartyConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PartyConflictError';
  }
}

export class PartyIdentifierTakenError extends Error {
  constructor(public readonly identifier: { type: PartyIdentifierType; country: string; value: string }) {
    super(`The ${identifier.country} ${identifier.type} belongs to another party`);
    this.name = 'PartyIdentifierTakenError';
  }
}

export type PartyErrorCode = 'not_found' | 'validation' | 'conflict';

export class PartyError extends Error {
  constructor(
    public readonly code: PartyErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PartyError';
  }
}

export interface PartyDeps {
  store: PartyStore;
  clock: { now(): string };
  ids: { next(prefix: string): string };
}

export interface PartyIdentifierInput {
  type: PartyIdentifierType;
  country: string;
  value: string;
}

export interface RegisterPartyInput extends PartyDetails {
  kind: PartyKind;
  market: string;
  identifiers?: PartyIdentifierInput[];
}

export interface ChangePartyInput extends PartyDetails {
  basedOnRevision: number;
  reason: string;
}

const COUNTRY = /^[A-Z]{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (s: unknown): s is string => typeof s === 'string' && DATE.test(s) && validDate(s);

function validDate(s: string): boolean {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Luhn check digit over a string of digits, as used in Swedish personal and organization numbers. */
export function luhnValid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let v = Number(digits[digits.length - 1 - i]) * (i % 2 === 1 ? 2 : 1);
    if (v > 9) v -= 9;
    sum += v;
  }
  return sum % 10 === 0;
}

/**
 * An identifier as stored. Swedish numbers are checked (Skatteverket SKV 704,
 * Bolagsverket): personal numbers as 12 digits with a valid date (day + 60 for a
 * coordination number) and check digit, organization numbers as 10 digits.
 * Other countries: upper case letters and digits only.
 */
export function normalizePartyIdentifier(i: PartyIdentifierInput): PartyIdentifierInput {
  if (!(PARTY_IDENTIFIER_TYPES as readonly string[]).includes(i.type)) throw new PartyError('validation', `Unknown identifier type '${i.type}'`);
  if (!COUNTRY.test(i.country ?? '')) throw new PartyError('validation', `Invalid country '${i.country}'`);
  const raw = (i.value ?? '').trim();
  if (i.country !== 'SE') {
    const v = raw.replace(/[\s.-]/g, '').toUpperCase();
    if (!/^[A-Z0-9]{4,30}$/.test(v)) throw new PartyError('validation', `Invalid ${i.type}`);
    return { type: i.type, country: i.country, value: v };
  }
  if (i.type === 'personal-number') {
    const v = raw.replace(/[\s+-]/g, '');
    if (!/^\d{12}$/.test(v)) throw new PartyError('validation', 'A Swedish personal number has 12 digits (YYYYMMDDNNNC)');
    const day = Number(v.slice(6, 8));
    const date = `${v.slice(0, 4)}-${v.slice(4, 6)}-${String(day > 60 ? day - 60 : day).padStart(2, '0')}`;
    if (!validDate(date) || !luhnValid(v.slice(2))) throw new PartyError('validation', 'Invalid Swedish personal number');
    return { type: i.type, country: 'SE', value: v };
  }
  let v = raw.replace(/[\s-]/g, '');
  if (/^16\d{10}$/.test(v)) v = v.slice(2);
  if (!/^\d{10}$/.test(v) || Number(v[2]) < 2 || !luhnValid(v)) throw new PartyError('validation', 'Invalid Swedish organization number');
  return { type: i.type, country: 'SE', value: v };
}

/** Masks a personal number: a Swedish one keeps its date of birth, others keep nothing. Pure. */
export function maskIdentifier(i: PartyIdentifier): ShownIdentifier {
  if (i.type !== 'personal-number') return { ...i, masked: false };
  const value = i.country === 'SE' ? `${i.value.slice(0, 8)}-****` : '*'.repeat(8);
  return { ...i, value, masked: true };
}

/** The party as shown through the API: personal numbers masked. Pure. */
export function publicView(p: PartyRecord): PartyView {
  return { ...p, identifiers: p.identifiers.map(maskIdentifier) };
}

/** The name to show: given and family name for a person, the name for an organization. Pure. */
export function displayName(p: PartyDetails & { kind: PartyKind }): string {
  return p.kind === 'person' ? `${p.givenName ?? ''} ${p.familyName ?? ''}`.trim() : (p.name ?? '');
}

export class PartyService {
  constructor(private readonly d: PartyDeps) {}

  async get(id: string): Promise<PartyRecord> {
    const p = await this.d.store.get(id);
    if (!p) throw new PartyError('not_found', `Party ${id} does not exist`);
    return p;
  }

  /** The party's market, or null if it does not exist. For other modules that point at parties. */
  async marketOf(id: string): Promise<string | null> {
    return (await this.d.store.get(id))?.market ?? null;
  }

  async revisions(id: string): Promise<Party[]> {
    await this.get(id);
    return this.d.store.revisions(id);
  }

  async findByIdentifier(input: PartyIdentifierInput): Promise<PartyRecord[]> {
    const i = normalizePartyIdentifier(input);
    const id = await this.d.store.findByIdentifier(i.type, i.country, i.value);
    return id ? [await this.get(id)] : [];
  }

  async register(input: RegisterPartyInput, by: string): Promise<PartyRecord> {
    if (!(PARTY_KINDS as readonly string[]).includes(input.kind)) throw new PartyError('validation', `Unknown kind '${input.kind}'`);
    if (!COUNTRY.test(input.market ?? '')) throw new PartyError('validation', `Invalid market '${input.market}'`);
    const details = this.details(input.kind, input);
    const identifiers = (input.identifiers ?? []).map(normalizePartyIdentifier);
    for (const i of identifiers) this.checkKind(input.kind, i);
    if (new Set(identifiers.map((i) => `${i.type}:${i.country}:${i.value}`)).size !== identifiers.length) {
      throw new PartyError('validation', 'An identifier is listed twice');
    }
    const now = this.d.clock.now();
    const party: Party = { id: this.d.ids.next('pty'), revision: 1, kind: input.kind, market: input.market, ...details, changedBy: by, changedAt: now };
    await this.d.store.register(party, identifiers.map((i) => ({ ...i, addedBy: by, addedAt: now }))).catch(this.translate);
    return this.get(party.id);
  }

  /** Replaces the details with a new revision. Kind and market never change. */
  async change(id: string, input: ChangePartyInput, by: string): Promise<PartyRecord> {
    const cur = await this.get(id);
    if (cur.revision !== input.basedOnRevision) {
      throw new PartyError('conflict', `Party ${id} is at revision ${cur.revision}, not ${input.basedOnRevision}`);
    }
    const reason = (input.reason ?? '').trim();
    if (!reason) throw new PartyError('validation', 'A reason is required');
    const next: Party = {
      id,
      revision: cur.revision + 1,
      kind: cur.kind,
      market: cur.market,
      ...this.details(cur.kind, input),
      changedBy: by,
      changedAt: this.d.clock.now(),
      reason,
    };
    await this.d.store.appendRevision(next).catch(this.translate);
    return this.get(id);
  }

  async addIdentifier(id: string, input: PartyIdentifierInput, by: string): Promise<PartyRecord> {
    const cur = await this.get(id);
    const i = normalizePartyIdentifier(input);
    this.checkKind(cur.kind, i);
    if (cur.identifiers.some((x) => x.type === i.type && x.country === i.country && x.value === i.value)) return cur; // a retry
    await this.d.store.addIdentifier(id, { ...i, addedBy: by, addedAt: this.d.clock.now() }).catch(this.translate);
    return this.get(id);
  }

  private checkKind(kind: PartyKind, i: PartyIdentifierInput) {
    const ok = kind === 'person' ? i.type === 'personal-number' : i.type === 'organization-number';
    if (!ok) throw new PartyError('validation', `A ${kind} cannot have a ${i.type}`);
  }

  /** Checks and trims the details for the kind, and drops empty ones. */
  private details(kind: PartyKind, input: PartyDetails): PartyDetails {
    const text = (field: string, v: unknown, max: number): string | undefined => {
      if (v === undefined || v === null) return undefined;
      if (typeof v !== 'string') throw new PartyError('validation', `${field} must be text`);
      const t = v.trim().replace(/\s+/g, ' ');
      if (t.length > max) throw new PartyError('validation', `${field} is longer than ${max} characters`);
      return t || undefined;
    };
    const out: PartyDetails = {};
    if (kind === 'person') {
      if (input.name !== undefined) throw new PartyError('validation', 'A person has givenName and familyName, not name');
      out.givenName = text('givenName', input.givenName, 100);
      out.familyName = text('familyName', input.familyName, 100);
      if (!out.givenName || !out.familyName) throw new PartyError('validation', 'A person needs givenName and familyName');
      if (input.birthDate !== undefined) {
        if (!isDate(input.birthDate) || input.birthDate > this.today()) throw new PartyError('validation', 'birthDate must be a date not after today');
        out.birthDate = input.birthDate;
      }
    } else {
      if (input.givenName !== undefined || input.familyName !== undefined || input.birthDate !== undefined) {
        throw new PartyError('validation', 'An organization has name, not givenName, familyName or birthDate');
      }
      out.name = text('name', input.name, 200);
      if (!out.name) throw new PartyError('validation', 'An organization needs a name');
    }
    const email = text('email', input.email, 254);
    if (email !== undefined) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new PartyError('validation', 'Invalid email');
      out.email = email;
    }
    if (input.phone !== undefined) {
      const phone = String(input.phone).replace(/[\s()-]/g, '');
      if (!/^\+[1-9]\d{6,14}$/.test(phone)) throw new PartyError('validation', 'phone must be in international format, e.g. +46701234567');
      out.phone = phone;
    }
    if (input.address !== undefined) {
      const a = input.address;
      const street = text('address.street', a?.street, 200);
      const postalCode = text('address.postalCode', a?.postalCode, 12);
      const city = text('address.city', a?.city, 100);
      if (!street || !postalCode || !city || !COUNTRY.test(a?.country ?? '')) {
        throw new PartyError('validation', 'An address needs street, postalCode, city and country (ISO 3166-1 alpha-2)');
      }
      out.address = { street, postalCode, city, country: a.country };
    }
    if (input.language !== undefined) {
      if (!/^[a-z]{2}$/.test(input.language)) throw new PartyError('validation', 'language must be ISO 639-1, e.g. sv');
      out.language = input.language;
    }
    return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as PartyDetails;
  }

  private today(): ISODate {
    return this.d.clock.now().slice(0, 10);
  }

  private translate = (e: unknown): never => {
    if (e instanceof PartyIdentifierTakenError || e instanceof PartyConflictError) throw new PartyError('conflict', e.message);
    throw e;
  };
}

/** In-memory store, for tests and the dev server without a database. */
export class InMemoryPartyStore implements PartyStore {
  private parties: Party[] = [];
  private identifiers = new Map<string, PartyIdentifier & { partyId: string }>();

  async get(id: string): Promise<PartyRecord | null> {
    const latest = (await this.revisions(id)).at(-1);
    if (!latest) return null;
    return structuredClone({
      ...latest,
      identifiers: [...this.identifiers.values()]
        .filter((i) => i.partyId === id)
        .sort((a, b) => (a.addedAt < b.addedAt ? -1 : a.addedAt > b.addedAt ? 1 : 0))
        .map(({ partyId: _p, ...i }) => i),
    });
  }

  async revisions(id: string) {
    return structuredClone(this.parties.filter((p) => p.id === id).sort((a, b) => a.revision - b.revision));
  }

  async findByIdentifier(type: PartyIdentifierType, country: string, value: string) {
    return this.identifiers.get(`${type}:${country}:${value}`)?.partyId ?? null;
  }

  async register(party: Party, identifiers: PartyIdentifier[]) {
    if (this.parties.some((p) => p.id === party.id)) throw new PartyConflictError(`Party ${party.id} exists`);
    for (const i of identifiers) if (this.identifiers.has(`${i.type}:${i.country}:${i.value}`)) throw new PartyIdentifierTakenError(i);
    this.parties.push(structuredClone(party));
    for (const i of identifiers) this.identifiers.set(`${i.type}:${i.country}:${i.value}`, { ...structuredClone(i), partyId: party.id });
  }

  async appendRevision(party: Party) {
    const last = (await this.revisions(party.id)).at(-1);
    if (!last || party.revision !== last.revision + 1) throw new PartyConflictError(`Party ${party.id} has changed`);
    if (party.kind !== last.kind || party.market !== last.market) throw new Error('Kind and market never change');
    this.parties.push(structuredClone(party));
  }

  async addIdentifier(partyId: string, i: PartyIdentifier) {
    const key = `${i.type}:${i.country}:${i.value}`;
    if (this.identifiers.has(key)) throw new PartyIdentifierTakenError(i);
    this.identifiers.set(key, { ...structuredClone(i), partyId });
  }
}
