/**
 * The animal register (ADR 0024).
 *
 * An animal has details (species, breed, sex, name, birth date, death) that
 * change through revisions, identifiers (microchip, registration number,
 * passport) that are unique and never removed, and owners with a validity
 * period. Nothing is overwritten: a correction is a new revision with a reason,
 * and a change of owner closes the previous ownership on the day the new one starts.
 *
 * Owners are party ids (`pty_…`). The party module (M2) will own the parties;
 * until then the register checks only the format.
 */

export type ISODate = string;

export const IDENTIFIER_TYPES = ['microchip', 'registration', 'passport'] as const;
export type IdentifierType = (typeof IDENTIFIER_TYPES)[number];

/** One revision of an animal's details. */
export interface Animal {
  id: string;
  revision: number;
  /** The market the animal is registered in. Limits who may see it (ADR 0016). Never changes. */
  market: string;
  /** Species code from the reference data. Never changes. */
  species: string;
  /** Breed code from the reference data, belonging to the species. Omitted: unknown. */
  breed?: string;
  /** Sex code from the reference data. */
  sex: string;
  neutered: boolean;
  name: string;
  birthDate: ISODate;
  deceasedOn?: ISODate;
  changedBy: string;
  changedAt: string;
  /** Why the details were corrected. Required from revision 2. */
  reason?: string;
}

export interface AnimalIdentifier {
  type: IdentifierType;
  value: string;
  addedBy: string;
  addedAt: string;
}

export interface Ownership {
  /** 1, 2, 3 … per animal. */
  seq: number;
  partyId: string;
  validFrom: ISODate;
  /** The first day the party no longer owns the animal. Omitted: the current owner. */
  validTo?: ISODate;
  recordedBy: string;
  recordedAt: string;
  reason?: string;
}

/** An animal with its current details, identifiers and every ownership. */
export interface AnimalRecord extends Animal {
  identifiers: AnimalIdentifier[];
  ownerships: Ownership[];
}

export interface AnimalStore {
  get(id: string): Promise<AnimalRecord | null>;
  /** Every revision of the details, oldest first. */
  revisions(id: string): Promise<Animal[]>;
  findByIdentifier(type: IdentifierType, value: string): Promise<string | null>;
  /** Animals the party owns on the date. */
  findByOwner(partyId: string, onDate: ISODate): Promise<string[]>;
  /** Stores a new animal with its first revision, identifiers and owner, all or nothing. */
  register(animal: Animal, identifiers: AnimalIdentifier[], owner: Ownership): Promise<void>;
  /** Throws AnimalConflictError unless it is the next revision. */
  appendRevision(animal: Animal): Promise<void>;
  /** Throws IdentifierTakenError if any animal already has it. */
  addIdentifier(animalId: string, identifier: AnimalIdentifier): Promise<void>;
  /**
   * Closes ownership `closesSeq` on `next.validFrom` and adds `next`, all or nothing.
   * Throws AnimalConflictError if `closesSeq` is not the open ownership.
   */
  transfer(animalId: string, closesSeq: number, next: Ownership): Promise<void>;
}

export class AnimalConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnimalConflictError';
  }
}

export class IdentifierTakenError extends Error {
  constructor(
    public readonly identifier: { type: IdentifierType; value: string },
  ) {
    super(`The ${identifier.type} ${identifier.value} belongs to another animal`);
    this.name = 'IdentifierTakenError';
  }
}

export type AnimalErrorCode = 'not_found' | 'validation' | 'conflict';

export class AnimalError extends Error {
  constructor(
    public readonly code: AnimalErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AnimalError';
  }
}

/** Reads reference data, e.g. the catalog's ReferenceDataStore. */
export interface ReferencePort {
  get(kind: 'species' | 'breed' | 'sex', code: string): Promise<{ active: boolean; parent?: string } | null>;
}

export interface AnimalDeps {
  store: AnimalStore;
  references: ReferencePort;
  clock: { now(): string };
  ids: { next(prefix: string): string };
}

export interface IdentifierInput {
  type: IdentifierType;
  value: string;
}

export interface RegisterInput {
  market: string;
  species: string;
  breed?: string;
  sex: string;
  neutered?: boolean;
  name: string;
  birthDate: ISODate;
  identifiers?: IdentifierInput[];
  owner: { partyId: string; from: ISODate };
}

export interface CorrectionInput {
  basedOnRevision: number;
  reason: string;
  breed?: string;
  sex: string;
  neutered: boolean;
  name: string;
  birthDate: ISODate;
  deceasedOn?: ISODate;
}

const PARTY = /^pty_[A-Za-z0-9]{1,64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (s: unknown): s is string => typeof s === 'string' && DATE.test(s) && !Number.isNaN(Date.parse(s));

/** An identifier as stored: microchips are 15 digits (ISO 11784), other numbers upper case without extra spaces. */
export function normalizeIdentifier(i: IdentifierInput): IdentifierInput {
  if (!(IDENTIFIER_TYPES as readonly string[]).includes(i.type)) throw new AnimalError('validation', `Unknown identifier type '${i.type}'`);
  const raw = (i.value ?? '').trim();
  if (i.type === 'microchip') {
    const v = raw.replace(/[\s-]/g, '');
    if (!/^\d{15}$/.test(v)) throw new AnimalError('validation', 'A microchip number has 15 digits (ISO 11784)');
    return { type: i.type, value: v };
  }
  const v = raw.replace(/\s+/g, ' ').toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9 /.-]{0,39}$/.test(v)) throw new AnimalError('validation', `Invalid ${i.type} number`);
  return { type: i.type, value: v };
}

/** The owner on a date, if any. Pure. */
export function ownerOn(ownerships: readonly Ownership[], date: ISODate): Ownership | null {
  return ownerships.find((o) => o.validFrom <= date && (!o.validTo || date < o.validTo)) ?? null;
}

export class AnimalService {
  constructor(private readonly d: AnimalDeps) {}

  async get(id: string): Promise<AnimalRecord> {
    const a = await this.d.store.get(id);
    if (!a) throw new AnimalError('not_found', `Animal ${id} does not exist`);
    return a;
  }

  async revisions(id: string): Promise<Animal[]> {
    await this.get(id);
    return this.d.store.revisions(id);
  }

  async findByIdentifier(input: IdentifierInput): Promise<AnimalRecord[]> {
    const i = normalizeIdentifier(input);
    const id = await this.d.store.findByIdentifier(i.type, i.value);
    return id ? [await this.get(id)] : [];
  }

  /** Animals the party owns today. */
  async findByOwner(partyId: string): Promise<AnimalRecord[]> {
    if (!PARTY.test(partyId)) throw new AnimalError('validation', `Invalid party id '${partyId}'`);
    const ids = await this.d.store.findByOwner(partyId, this.today());
    return Promise.all(ids.map((id) => this.get(id)));
  }

  async register(input: RegisterInput, by: string): Promise<AnimalRecord> {
    if (!/^[A-Z]{2}$/.test(input.market)) throw new AnimalError('validation', `Invalid market '${input.market}'`);
    await this.reference('species', input.species);
    await this.checkDetails(input.species, input);
    if (!PARTY.test(input.owner?.partyId ?? '')) throw new AnimalError('validation', `Invalid party id '${input.owner?.partyId}'`);
    if (!isDate(input.owner.from) || input.owner.from < input.birthDate) {
      throw new AnimalError('validation', 'The owner must be from a date on or after the birth date');
    }
    const identifiers = this.uniqueIdentifiers(input.identifiers ?? []);
    const now = this.d.clock.now();
    const animal: Animal = {
      id: this.d.ids.next('ani'),
      revision: 1,
      market: input.market,
      species: input.species,
      ...(input.breed ? { breed: input.breed } : {}),
      sex: input.sex,
      neutered: input.neutered ?? false,
      name: input.name.trim(),
      birthDate: input.birthDate,
      changedBy: by,
      changedAt: now,
    };
    const owner: Ownership = { seq: 1, partyId: input.owner.partyId, validFrom: input.owner.from, recordedBy: by, recordedAt: now };
    await this.d.store
      .register(
        animal,
        identifiers.map((i) => ({ ...i, addedBy: by, addedAt: now })),
        owner,
      )
      .catch(this.translate);
    return this.get(animal.id);
  }

  /** Corrects or updates the details, e.g. neutered or deceased. Species and market never change. */
  async correct(id: string, input: CorrectionInput, by: string): Promise<AnimalRecord> {
    const cur = await this.get(id);
    if (cur.revision !== input.basedOnRevision) {
      throw new AnimalError('conflict', `Animal ${id} is at revision ${cur.revision}, not ${input.basedOnRevision}`);
    }
    const reason = (input.reason ?? '').trim();
    if (!reason) throw new AnimalError('validation', 'A reason is required');
    await this.checkDetails(cur.species, input);
    if (input.deceasedOn !== undefined) {
      if (!isDate(input.deceasedOn) || input.deceasedOn < input.birthDate || input.deceasedOn > this.today()) {
        throw new AnimalError('validation', 'deceasedOn must be a date from the birth date up to today');
      }
    }
    const firstOwner = cur.ownerships[0];
    if (firstOwner && firstOwner.validFrom < input.birthDate) throw new AnimalError('validation', 'The birth date cannot be after the first owner');
    const next: Animal = {
      id,
      revision: cur.revision + 1,
      market: cur.market,
      species: cur.species,
      ...(input.breed ? { breed: input.breed } : {}),
      sex: input.sex,
      neutered: input.neutered,
      name: input.name.trim(),
      birthDate: input.birthDate,
      ...(input.deceasedOn ? { deceasedOn: input.deceasedOn } : {}),
      changedBy: by,
      changedAt: this.d.clock.now(),
      reason,
    };
    await this.d.store.appendRevision(next).catch(this.translate);
    return this.get(id);
  }

  async addIdentifier(id: string, input: IdentifierInput, by: string): Promise<AnimalRecord> {
    const cur = await this.get(id);
    const i = normalizeIdentifier(input);
    if (cur.identifiers.some((x) => x.type === i.type && x.value === i.value)) return cur; // already there: a retry
    await this.d.store.addIdentifier(id, { ...i, addedBy: by, addedAt: this.d.clock.now() }).catch(this.translate);
    return this.get(id);
  }

  /** A new owner from a date. The current ownership ends that day. */
  async transfer(id: string, input: { partyId: string; from: ISODate; reason?: string }, by: string): Promise<AnimalRecord> {
    const cur = await this.get(id);
    if (!PARTY.test(input.partyId ?? '')) throw new AnimalError('validation', `Invalid party id '${input.partyId}'`);
    if (!isDate(input.from)) throw new AnimalError('validation', 'from must be YYYY-MM-DD');
    const open = cur.ownerships.find((o) => !o.validTo);
    if (!open) throw new AnimalError('conflict', `Animal ${id} has no current owner`);
    if (open.partyId === input.partyId) throw new AnimalError('conflict', `${input.partyId} already owns animal ${id}`);
    if (input.from <= open.validFrom) throw new AnimalError('validation', `The new owner must start after ${open.validFrom}`);
    if (cur.deceasedOn && input.from > cur.deceasedOn) throw new AnimalError('validation', `Animal ${id} died ${cur.deceasedOn}`);
    const reason = input.reason?.trim();
    const next: Ownership = {
      seq: open.seq + 1,
      partyId: input.partyId,
      validFrom: input.from,
      recordedBy: by,
      recordedAt: this.d.clock.now(),
      ...(reason ? { reason } : {}),
    };
    await this.d.store.transfer(id, open.seq, next).catch(this.translate);
    return this.get(id);
  }

  private async checkDetails(species: string, input: { breed?: string; sex: string; name: string; birthDate: ISODate; neutered?: boolean }) {
    if (input.breed !== undefined) {
      const b = await this.reference('breed', input.breed);
      if (b.parent !== species) throw new AnimalError('validation', `The breed '${input.breed}' is not a ${species} breed`);
    }
    await this.reference('sex', input.sex);
    const name = (input.name ?? '').trim();
    if (!name || name.length > 100) throw new AnimalError('validation', 'The name must be 1-100 characters');
    if (!isDate(input.birthDate) || input.birthDate > this.today()) throw new AnimalError('validation', 'birthDate must be a date not after today');
    if (input.neutered !== undefined && typeof input.neutered !== 'boolean') throw new AnimalError('validation', 'neutered must be true or false');
  }

  private async reference(kind: 'species' | 'breed' | 'sex', code: string) {
    const r = await this.d.references.get(kind, code);
    if (!r || !r.active) throw new AnimalError('validation', `The ${kind} '${code}' does not exist or is not active`);
    return r;
  }

  private uniqueIdentifiers(list: IdentifierInput[]): IdentifierInput[] {
    const out = list.map(normalizeIdentifier);
    const keys = new Set(out.map((i) => `${i.type}:${i.value}`));
    if (keys.size !== out.length) throw new AnimalError('validation', 'An identifier is listed twice');
    return out;
  }

  private today(): ISODate {
    return this.d.clock.now().slice(0, 10);
  }

  private translate = (e: unknown): never => {
    if (e instanceof IdentifierTakenError || e instanceof AnimalConflictError) throw new AnimalError('conflict', e.message);
    throw e;
  };
}

/** In-memory store, for tests and the dev server without a database. */
export class InMemoryAnimalStore implements AnimalStore {
  private animals: Animal[] = [];
  private identifiers = new Map<string, AnimalIdentifier & { animalId: string }>();
  private owners: (Ownership & { animalId: string })[] = [];

  async get(id: string): Promise<AnimalRecord | null> {
    const latest = (await this.revisions(id)).at(-1);
    if (!latest) return null;
    return structuredClone({
      ...latest,
      identifiers: [...this.identifiers.values()]
        .filter((i) => i.animalId === id)
        .sort((a, b) => (a.addedAt < b.addedAt ? -1 : a.addedAt > b.addedAt ? 1 : 0))
        .map(({ animalId: _a, ...i }) => i),
      ownerships: this.owners
        .filter((o) => o.animalId === id)
        .sort((a, b) => a.seq - b.seq)
        .map(({ animalId: _a, ...o }) => o),
    });
  }

  async revisions(id: string) {
    return structuredClone(this.animals.filter((a) => a.id === id).sort((a, b) => a.revision - b.revision));
  }

  async findByIdentifier(type: IdentifierType, value: string) {
    return this.identifiers.get(`${type}:${value}`)?.animalId ?? null;
  }

  async findByOwner(partyId: string, onDate: ISODate) {
    return [...new Set(this.owners.filter((o) => o.partyId === partyId && ownerOn([o], onDate)).map((o) => o.animalId))].sort();
  }

  async register(animal: Animal, identifiers: AnimalIdentifier[], owner: Ownership) {
    if (this.animals.some((a) => a.id === animal.id)) throw new AnimalConflictError(`Animal ${animal.id} exists`);
    for (const i of identifiers) if (this.identifiers.has(`${i.type}:${i.value}`)) throw new IdentifierTakenError(i);
    this.animals.push(structuredClone(animal));
    for (const i of identifiers) this.identifiers.set(`${i.type}:${i.value}`, { ...structuredClone(i), animalId: animal.id });
    this.owners.push({ ...structuredClone(owner), animalId: animal.id });
  }

  async appendRevision(animal: Animal) {
    const last = (await this.revisions(animal.id)).at(-1);
    if (!last || animal.revision !== last.revision + 1) throw new AnimalConflictError(`Animal ${animal.id} has changed`);
    if (animal.market !== last.market || animal.species !== last.species) throw new Error('Market and species never change');
    this.animals.push(structuredClone(animal));
  }

  async addIdentifier(animalId: string, i: AnimalIdentifier) {
    if (this.identifiers.has(`${i.type}:${i.value}`)) throw new IdentifierTakenError(i);
    this.identifiers.set(`${i.type}:${i.value}`, { ...structuredClone(i), animalId });
  }

  async transfer(animalId: string, closesSeq: number, next: Ownership) {
    const open = this.owners.find((o) => o.animalId === animalId && o.seq === closesSeq && !o.validTo);
    const last = Math.max(0, ...this.owners.filter((o) => o.animalId === animalId).map((o) => o.seq));
    if (!open || next.seq !== last + 1) throw new AnimalConflictError(`The owner of animal ${animalId} has changed`);
    if (next.validFrom <= open.validFrom) throw new Error('A new ownership starts after the previous one');
    open.validTo = next.validFrom;
    this.owners.push({ ...structuredClone(next), animalId });
  }
}
