/**
 * Underwriting rules as a form instead of JSON (ADR 0031): age limits and
 * breed rules one per line, and each question and answer rule as its own group
 * of fields. The checks follow the engine's (validateUnderwriting), so the
 * form says what is wrong before anything is sent. The API validates again.
 * Pure; tested with node:test.
 */

type Content = Record<string, any>;
type Labels = Record<string, string>;

export interface QuestionForm {
  id: string;
  type: 'boolean' | 'diagnoses';
  /** Species separated by commas; empty: every species. */
  species: string;
  labels: Labels;
}

export interface AnswerRuleForm {
  question: string;
  outcome: 'rider' | 'refer' | 'decline';
  reason: string;
  /** Diagnosis codes separated by commas; for a diagnoses question. */
  onlyFor: string;
  /** For a rider: codes excluded besides the declared ones, separated by commas. */
  diagnosisCodes: string;
  riderDescription: string;
}

export interface UnderwritingForm {
  market: string;
  /** species; youngest in days; oldest in whole years (empty: no limit) per line. */
  ageLimits: string;
  questions: QuestionForm[];
  answerRules: AnswerRuleForm[];
  /** breed; refer or decline; reason per line. */
  breedRules: string;
}

const ID = /^[a-z][a-z0-9-]{1,63}$/;

export const isUnderwriting = (c: unknown): boolean => typeof c === 'object' && c !== null && 'ageLimits' in c && 'answerRules' in c;
export const emptyQuestion = (): QuestionForm => ({ id: '', type: 'boolean', species: '', labels: { sv: '', en: '' } });
export const emptyAnswerRule = (question = ''): AnswerRuleForm => ({ question, outcome: 'refer', reason: '', onlyFor: '', diagnosisCodes: '', riderDescription: '' });

const list = (text: string): string[] =>
  text
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
const rows = (text: string): string[][] =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split(';').map((x) => x.trim()));
const intOf = (text: string): number | null => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : null);
const cleanLabels = (labels: Labels): Labels => Object.fromEntries(Object.entries(labels).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v));

function ageLimitsOf(text: string) {
  const out: { species: string; minAgeDays: number; maxAgeYears?: number }[] = [];
  for (const [species, min, max, ...rest] of rows(text)) {
    const minAgeDays = intOf(min ?? '');
    const maxAgeYears = max ? intOf(max) : undefined;
    if (!species || minAgeDays === null || maxAgeYears === null || rest.length || out.some((l) => l.species === species)) return null;
    out.push({ species, minAgeDays, ...(maxAgeYears !== undefined ? { maxAgeYears } : {}) });
  }
  return out.length ? out : null;
}

function breedRulesOf(text: string) {
  const out: { breed: string; outcome: string; reason: string }[] = [];
  for (const [breed, outcome, reason, ...rest] of rows(text)) {
    if (!breed || !['refer', 'decline'].includes(outcome ?? '') || !ID.test(reason ?? '') || rest.length || out.some((b) => b.breed === breed)) return null;
    out.push({ breed, outcome: outcome!, reason: reason! });
  }
  return out;
}

export function underwritingFormFrom(c: Content): UnderwritingForm {
  return {
    market: c.market ?? '',
    ageLimits: (c.ageLimits ?? []).map((l: Content) => `${l.species}; ${l.minAgeDays}; ${l.maxAgeYears ?? ''}`.replace(/; $/, ';')).join('\n'),
    questions: (c.questions ?? []).map((q: Content) => ({ id: q.id, type: q.type, species: (q.species ?? []).join(', '), labels: { sv: '', en: '', ...q.labels } })),
    answerRules: (c.answerRules ?? []).map((r: Content) => ({
      question: r.question,
      outcome: r.outcome,
      reason: r.reason,
      onlyFor: (r.onlyFor ?? []).join(', '),
      diagnosisCodes: (r.diagnosisCodes ?? []).join(', '),
      riderDescription: r.riderDescription ?? '',
    })),
    breedRules: (c.breedRules ?? []).map((b: Content) => `${b.breed}; ${b.outcome}; ${b.reason}`).join('\n'),
  };
}

export function underwritingFormProblems(f: UnderwritingForm): string[] {
  const out = new Set<string>();
  if (!/^[A-Z]{2}$/.test(f.market.trim())) out.add('product.badMarket');
  if (!ageLimitsOf(f.ageLimits)) out.add('uwform.badAgeLimits');
  const ids = new Set<string>();
  for (const q of f.questions) {
    const labels = cleanLabels(q.labels);
    if (!ID.test(q.id.trim()) || !Object.keys(labels).length || Object.keys(labels).some((l) => !/^[a-z]{2}$/.test(l))) out.add('uwform.badQuestion');
    if (ids.has(q.id.trim())) out.add('uwform.duplicateQuestion');
    ids.add(q.id.trim());
  }
  for (const r of f.answerRules) {
    const q = f.questions.find((x) => x.id.trim() === r.question);
    if (!q || !ID.test(r.reason.trim())) out.add('uwform.badAnswerRule');
    if (list(r.onlyFor).length && q?.type !== 'diagnoses') out.add('uwform.onlyForNeedsDiagnoses');
    if (r.outcome === 'rider') {
      if (!r.riderDescription.trim() || (q?.type === 'boolean' && !list(r.diagnosisCodes).length)) out.add('uwform.badRider');
    }
  }
  if (!breedRulesOf(f.breedRules)) out.add('uwform.badBreedRules');
  return [...out];
}

export function underwritingContentFrom(f: UnderwritingForm, base: Content = {}): Content {
  return {
    ...base,
    market: f.market.trim(),
    ageLimits: ageLimitsOf(f.ageLimits),
    questions: f.questions.map((q) => {
      const species = list(q.species);
      return { id: q.id.trim(), type: q.type, labels: cleanLabels(q.labels), ...(species.length ? { species } : {}) };
    }),
    answerRules: f.answerRules.map((r) => {
      const onlyFor = list(r.onlyFor);
      const codes = list(r.diagnosisCodes);
      const rider = r.outcome === 'rider';
      return {
        question: r.question,
        outcome: r.outcome,
        reason: r.reason.trim(),
        ...(onlyFor.length ? { onlyFor } : {}),
        ...(rider && codes.length ? { diagnosisCodes: codes } : {}),
        ...(rider && r.riderDescription.trim() ? { riderDescription: r.riderDescription.trim() } : {}),
      };
    }),
    breedRules: breedRulesOf(f.breedRules),
  };
}
