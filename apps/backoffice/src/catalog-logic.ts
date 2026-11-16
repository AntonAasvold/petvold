/**
 * Products and rule sets in the back office (ADR 0021, 0023): drafts, review
 * with four eyes, publication, and the end of a version. Pure; tested with node:test.
 */
import type { Me } from './permissions.ts';

export type Kind = 'product' | 'rules';
export type LifecycleAction = 'edit' | 'submit' | 'publish' | 'return' | 'end' | 'copy';

const PERMISSIONS: Record<Kind, { write: string; publish: string }> = {
  product: { write: 'catalog:write', publish: 'catalog:publish' },
  rules: { write: 'rules:write', publish: 'rules:publish' },
};

/**
 * What a person may do with a version now. Publishing needs someone other than
 * the one who submitted it (four eyes). A product's end is the end of sales,
 * a rule set's its retirement.
 */
export function lifecycleActions(kind: Kind, v: { status: string; submittedBy?: string }, me: Me | null): LifecycleAction[] {
  const has = (p: string) => !!me?.permissions.includes(p);
  const { write, publish } = PERMISSIONS[kind];
  const out: LifecycleAction[] = [];
  if (v.status === 'draft' && has(write)) out.push('edit', 'submit');
  if (v.status === 'in_review' && has(publish)) {
    if (v.submittedBy !== me?.subject) out.push('publish');
    out.push('return');
  }
  if (v.status === 'published' && has(publish)) out.push('end');
  if (has(write)) out.push('copy');
  return out;
}

/** JSON from a text field, or where it went wrong. */
export function parseJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return { ok: false, error: 'The content must be a JSON object' };
    return { ok: true, value };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** A suggestion for a product's next version: '2026.2' after '2026.1', else the year and 1. */
export function nextProductVersion(versions: string[], year: number): string {
  const same = versions.map((v) => /^(\d{4})\.(\d+)$/.exec(v)).filter((m): m is RegExpExecArray => !!m && Number(m[1]) === year);
  const n = Math.max(0, ...same.map((m) => Number(m[2])));
  return `${year}.${n + 1}`;
}
