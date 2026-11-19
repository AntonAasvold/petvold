/**
 * Parties in the back office (ADR 0026): the form for a person or an
 * organization, what is missing, and the bodies for registering and changing.
 * A change replaces every detail, so the form starts from the current ones and
 * sends them all. Pure; tested with node:test. The API validates again.
 */

export interface PartyForm {
  kind: 'person' | 'organization';
  market: string;
  givenName: string;
  familyName: string;
  birthDate: string;
  name: string;
  email: string;
  phone: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
  language: string;
}

export interface IdentifierForm {
  type: 'personal-number' | 'organization-number';
  country: string;
  value: string;
}

export const emptyParty = (market = 'SE'): PartyForm => ({
  kind: 'person',
  market,
  givenName: '',
  familyName: '',
  birthDate: '',
  name: '',
  email: '',
  phone: '',
  street: '',
  postalCode: '',
  city: '',
  country: market,
  language: '',
});

type Details = {
  givenName?: string;
  familyName?: string;
  birthDate?: string;
  name?: string;
  email?: string;
  phone?: string;
  address?: { street: string; postalCode: string; city: string; country: string };
  language?: string;
};

/** The form from a stored party, for changing it. */
export function partyToForm(p: { kind: 'person' | 'organization'; market: string } & Details): PartyForm {
  return {
    kind: p.kind,
    market: p.market,
    givenName: p.givenName ?? '',
    familyName: p.familyName ?? '',
    birthDate: p.birthDate ?? '',
    name: p.name ?? '',
    email: p.email ?? '',
    phone: p.phone ?? '',
    street: p.address?.street ?? '',
    postalCode: p.address?.postalCode ?? '',
    city: p.address?.city ?? '',
    country: p.address?.country ?? p.market,
    language: p.language ?? '',
  };
}

/** What is missing or wrong, as message ids. Empty: it may be sent. */
export function partyProblems(f: PartyForm): string[] {
  const out: string[] = [];
  if (!/^[A-Z]{2}$/.test(f.market)) out.push('settings.badMarket');
  if (f.kind === 'person' && (!f.givenName.trim() || !f.familyName.trim())) out.push('party.needName');
  if (f.kind === 'organization' && !f.name.trim()) out.push('party.needOrgName');
  if (f.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) out.push('party.badEmail');
  if (f.phone.trim() && !/^\+[1-9]\d{6,14}$/.test(f.phone.replace(/[\s-]/g, ''))) out.push('party.badPhone');
  const address = [f.street, f.postalCode, f.city].map((x) => x.trim());
  if (address.some(Boolean) && !address.every(Boolean)) out.push('party.partAddress');
  if (f.language.trim() && !/^[a-z]{2}$/.test(f.language.trim())) out.push('party.badLanguage');
  return out;
}

/** The details as the API takes them: empty fields left out, the address whole or not at all. */
export function partyDetails(f: PartyForm): Details {
  const t = (s: string) => s.trim();
  const person = f.kind === 'person';
  return {
    ...(person && t(f.givenName) ? { givenName: t(f.givenName) } : {}),
    ...(person && t(f.familyName) ? { familyName: t(f.familyName) } : {}),
    ...(person && f.birthDate ? { birthDate: f.birthDate } : {}),
    ...(!person && t(f.name) ? { name: t(f.name) } : {}),
    ...(t(f.email) ? { email: t(f.email) } : {}),
    ...(t(f.phone) ? { phone: f.phone.replace(/[\s-]/g, '') } : {}),
    ...(t(f.street) && t(f.postalCode) && t(f.city) ? { address: { street: t(f.street), postalCode: t(f.postalCode), city: t(f.city), country: f.country || f.market } } : {}),
    ...(t(f.language) ? { language: t(f.language) } : {}),
  };
}

/** The body for POST /v1/parties, with a number if one was given. */
export function registerBody(f: PartyForm, id: IdentifierForm | null) {
  return { kind: f.kind, market: f.market, ...partyDetails(f), ...(id && id.value.trim() ? { identifiers: [{ type: id.type, country: id.country, value: id.value.trim() }] } : {}) };
}

/** The body for PUT /v1/parties/{id}: every detail, on the revision the person saw. */
export function changeBody(f: PartyForm, basedOnRevision: number, reason: string) {
  return { basedOnRevision, reason: reason.trim(), ...partyDetails(f) };
}

/** A party's name as a person reads it. */
export function displayName(p: { kind?: string; givenName?: string; familyName?: string; name?: string; anonymized?: boolean } | null | undefined): string {
  if (!p) return '';
  if (p.anonymized) return '–';
  return [p.givenName, p.familyName].filter(Boolean).join(' ') || p.name || '';
}
