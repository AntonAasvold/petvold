/**
 * Reference data in the back office (ADR 0022): species, breeds and sexes with
 * labels per language, changed as revisions with a reason. Pure, so it is
 * tested without a browser. The API decides every call.
 */

export type ReferenceKind = 'species' | 'breed' | 'sex';
export const REFERENCE_KINDS: ReferenceKind[] = ['species', 'breed', 'sex'];

export interface ReferenceForm {
  code: string;
  /** Language -> label, e.g. sv and en. An empty label is left out. */
  labels: Record<string, string>;
  /** A new breed's species. */
  parent: string;
  active: boolean;
  reason: string;
}

export type ReferenceProblem = 'code' | 'labels' | 'parent' | 'reason';

/** What the API would refuse. A new code needs a code and, for a breed, its species; a change needs a reason. */
export function referenceProblems(kind: ReferenceKind, form: ReferenceForm, isNew: boolean): ReferenceProblem[] {
  const out: ReferenceProblem[] = [];
  if (isNew && !/^[a-z0-9][a-z0-9-]{0,63}$/.test(form.code.trim())) out.push('code');
  if (!Object.values(form.labels).some((l) => l.trim())) out.push('labels');
  if (isNew && kind === 'breed' && !form.parent.trim()) out.push('parent');
  if (!isNew && (!form.reason.trim() || form.reason.trim().length > 2000)) out.push('reason');
  return out;
}

/** The body of PUT /v1/reference-data/{kind}/{code}. */
export function referenceBody(kind: ReferenceKind, form: ReferenceForm, basedOnRevision?: number) {
  const labels = Object.fromEntries(Object.entries(form.labels).filter(([, l]) => l.trim()).map(([lang, l]) => [lang, l.trim()]));
  return {
    labels,
    active: form.active,
    ...(basedOnRevision === undefined && kind === 'breed' ? { parent: form.parent.trim() } : {}),
    ...(basedOnRevision !== undefined ? { basedOnRevision, reason: form.reason.trim() } : {}),
  };
}

/** A suggested code from an English label: "Labrador Retriever" for a dog becomes dog-labrador-retriever. Pure. */
export function suggestCode(kind: ReferenceKind, label: string, parent: string): string {
  const slug = label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return kind === 'breed' && parent && slug ? `${parent}-${slug}`.slice(0, 64) : slug.slice(0, 64);
}
