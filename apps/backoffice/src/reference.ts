/**
 * Species, breeds and sexes from the reference data (ADR 0022), with labels in
 * the user's language (the API answers by Accept-Language). Read once per
 * language and kept, since they change seldom.
 */
import type { Api } from './api/client.ts';
import { getLocale } from './i18n.ts';

export interface RefItem {
  code: string;
  label: string;
  parent?: string;
}

export interface References {
  species: RefItem[];
  breeds: RefItem[];
  sexes: RefItem[];
}

const cache = new Map<string, Promise<References>>();

export function loadReferences(api: Api): Promise<References> {
  const lang = getLocale();
  let r = cache.get(lang);
  if (!r) {
    const kind = async (k: 'species' | 'breed' | 'sex') => {
      const { data } = await api.GET('/v1/reference-data/{kind}', { params: { path: { kind: k }, query: { active: 'true' } } });
      return (data?.items ?? []).map((i) => ({ code: i.code, label: i.label, ...(i.parent ? { parent: i.parent } : {}) }));
    };
    r = Promise.all([kind('species'), kind('breed'), kind('sex')]).then(([species, breeds, sexes]) => ({ species, breeds, sexes }));
    // A failure is not kept, so the next view tries again.
    r.catch(() => cache.delete(lang));
    cache.set(lang, r);
  }
  return r;
}

/** A code's label, or the code itself when it is unknown or inactive. */
export const labelOf = (items: RefItem[], code: string | undefined): string => (code ? (items.find((i) => i.code === code)?.label ?? code) : '–');
