/**
 * Animals in the back office (ADR 0024, 0027): the forms for registering,
 * correcting, transferring and a litter, what is missing, and the bodies.
 * Species, breed and sex are codes from the reference data (ADR 0022). Pure;
 * tested with node:test. The API validates again.
 */

export const IDENTIFIER_TYPES = ['microchip', 'registration', 'passport'] as const;
export type IdentifierType = (typeof IDENTIFIER_TYPES)[number];

export interface AnimalForm {
  market: string;
  species: string;
  breed: string;
  sex: string;
  neutered: boolean;
  name: string;
  birthDate: string;
  deceasedOn: string;
  allowLookup: boolean;
  microchip: string;
  ownerPartyId: string;
  ownerFrom: string;
}

export const emptyAnimal = (today: string, owner = '', market = 'SE'): AnimalForm => ({
  market,
  species: '',
  breed: '',
  sex: '',
  neutered: false,
  name: '',
  birthDate: '',
  deceasedOn: '',
  allowLookup: false,
  microchip: '',
  ownerPartyId: owner,
  ownerFrom: today,
});

const PARTY_ID = /^pty_[A-Za-z0-9]{1,64}$/;

/** A microchip is 15 digits (ISO 11784); spaces and hyphens are ignored. */
export const normalizeChip = (s: string): string => s.replace(/[\s-]/g, '');

/** What a new animal is missing, as message ids. */
export function animalProblems(f: AnimalForm, today: string): string[] {
  const out: string[] = [];
  if (!/^[A-Z]{2}$/.test(f.market)) out.push('settings.badMarket');
  if (!f.species) out.push('animal.needSpecies');
  if (!f.sex) out.push('animal.needSex');
  if (!f.name.trim()) out.push('animal.needName');
  if (!f.birthDate) out.push('animal.needBirthDate');
  else if (f.birthDate > today) out.push('animal.futureBirth');
  if (f.microchip.trim() && !/^\d{15}$/.test(normalizeChip(f.microchip))) out.push('animal.badChip');
  if (!PARTY_ID.test(f.ownerPartyId.trim())) out.push('animal.needOwner');
  if (!f.ownerFrom) out.push('animal.needOwnerFrom');
  return out;
}

/** The body for POST /v1/animals. */
export function registerAnimalBody(f: AnimalForm) {
  return {
    market: f.market,
    species: f.species,
    ...(f.breed ? { breed: f.breed } : {}),
    sex: f.sex,
    neutered: f.neutered,
    name: f.name.trim(),
    birthDate: f.birthDate,
    allowLookup: f.allowLookup,
    ...(f.microchip.trim() ? { identifiers: [{ type: 'microchip' as const, value: normalizeChip(f.microchip) }] } : {}),
    owner: { partyId: f.ownerPartyId.trim(), from: f.ownerFrom },
  };
}

/** The form from a stored animal, for correcting it. */
export function animalToForm(a: { market: string; species: string; breed?: string; sex: string; neutered: boolean; name: string; birthDate: string; deceasedOn?: string; allowLookup: boolean }): AnimalForm {
  return { ...emptyAnimal('', '', a.market), species: a.species, breed: a.breed ?? '', sex: a.sex, neutered: a.neutered, name: a.name, birthDate: a.birthDate, deceasedOn: a.deceasedOn ?? '', allowLookup: a.allowLookup };
}

/** What a correction is missing. Market, species and owner never change here. */
export function correctionProblems(f: AnimalForm, reason: string, today: string): string[] {
  const out: string[] = [];
  if (!f.sex) out.push('animal.needSex');
  if (!f.name.trim()) out.push('animal.needName');
  if (!f.birthDate) out.push('animal.needBirthDate');
  if (f.deceasedOn && (f.deceasedOn < f.birthDate || f.deceasedOn > today)) out.push('animal.badDeath');
  if (!reason.trim()) out.push('settings.needReason');
  return out;
}

/** The body for PUT /v1/animals/{id}: a new revision on the one the person saw. */
export function correctionBody(f: AnimalForm, basedOnRevision: number, reason: string) {
  return {
    basedOnRevision,
    reason: reason.trim(),
    ...(f.breed ? { breed: f.breed } : {}),
    sex: f.sex,
    neutered: f.neutered,
    name: f.name.trim(),
    birthDate: f.birthDate,
    ...(f.deceasedOn ? { deceasedOn: f.deceasedOn } : {}),
    allowLookup: f.allowLookup,
  };
}

/** What a change of owner is missing. */
export function transferProblems(t: { partyId: string; from: string }, current: { partyId: string; validFrom: string } | undefined): string[] {
  const out: string[] = [];
  if (!PARTY_ID.test(t.partyId.trim())) out.push('animal.needOwner');
  else if (current && t.partyId.trim() === current.partyId) out.push('animal.sameOwner');
  if (!t.from) out.push('animal.needOwnerFrom');
  else if (current && t.from <= current.validFrom) out.push('animal.transferBefore');
  return out;
}

/** The owner on a date: the ownership that has begun and not ended. */
export function ownerOn<O extends { validFrom: string; validTo?: string }>(ownerships: O[], date: string): O | undefined {
  return ownerships.find((o) => o.validFrom <= date && (!o.validTo || date < o.validTo));
}

export interface LitterAnimalForm {
  name: string;
  sex: string;
  breed: string;
  microchip: string;
}

export interface LitterForm {
  market: string;
  species: string;
  birthDate: string;
  damId: string;
  sireId: string;
  breederPartyId: string;
  animals: LitterAnimalForm[];
}

export const emptyLitterAnimal = (): LitterAnimalForm => ({ name: '', sex: '', breed: '', microchip: '' });

/** What a litter is missing. */
export function litterProblems(f: LitterForm, today: string): string[] {
  const out: string[] = [];
  if (!f.species) out.push('animal.needSpecies');
  if (!f.birthDate) out.push('animal.needBirthDate');
  else if (f.birthDate > today) out.push('animal.futureBirth');
  if (!PARTY_ID.test(f.breederPartyId.trim())) out.push('animal.needBreeder');
  for (const id of [f.damId, f.sireId]) if (id.trim() && !/^ani_[A-Za-z0-9]+$/.test(id.trim())) out.push('animal.badParent');
  if (!f.animals.length || f.animals.length > 24) out.push('animal.litterSize');
  if (f.animals.some((a) => !a.name.trim() || !a.sex)) out.push('animal.litterAnimal');
  if (f.animals.some((a) => a.microchip.trim() && !/^\d{15}$/.test(normalizeChip(a.microchip)))) out.push('animal.badChip');
  return [...new Set(out)];
}

/** The body for POST /v1/litters. */
export function litterBody(f: LitterForm) {
  return {
    market: f.market,
    species: f.species,
    birthDate: f.birthDate,
    ...(f.damId.trim() ? { damId: f.damId.trim() } : {}),
    ...(f.sireId.trim() ? { sireId: f.sireId.trim() } : {}),
    breederPartyId: f.breederPartyId.trim(),
    animals: f.animals.map((a) => ({
      name: a.name.trim(),
      sex: a.sex,
      ...(a.breed ? { breed: a.breed } : {}),
      ...(a.microchip.trim() ? { identifiers: [{ type: 'microchip' as const, value: normalizeChip(a.microchip) }] } : {}),
    })),
  };
}
