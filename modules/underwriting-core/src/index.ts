/**
 * Underwriting rules (ADR 0031): whether an application for a new policy is
 * accepted, accepted with riders, referred to a person or declined, as a pure
 * function of a versioned rule set and the facts about the animal and the
 * answers to the health questions.
 *
 * No I/O, no framework, no text for users: questions carry the insurer's own
 * labels as data, and every outcome has a reason code that the channel
 * explains in the customer's language. Every check is listed, so an outcome
 * can be explained and recomputed like a claims decision (ADR 0018).
 */
import { createHash } from 'node:crypto';

export type ISODate = string;

/** The calculation models an underwriting rule set can have. */
export const UNDERWRITING_MODELS = ['underwriting.v1'] as const;

export type Outcome = 'accept' | 'accept-with-riders' | 'refer' | 'decline';

/** What a rule leads to when it applies. */
export type RuleOutcome = 'rider' | 'refer' | 'decline';

export interface Question {
  /** e.g. 'previous-illness'. */
  id: string;
  /** boolean: yes or no. diagnoses: yes or no, and with yes the diagnosis codes (reference data). */
  type: 'boolean' | 'diagnoses';
  /** The question per language, e.g. { sv: '…', en: '…' }. Shown by the channel. */
  labels: Record<string, string>;
  /** Asked only for these species. Omitted: every species. */
  species?: string[];
}

/** What a yes to a question leads to. */
export interface AnswerRule {
  question: string;
  outcome: RuleOutcome;
  /** A code the channel explains, e.g. 'previous-ear-disease'. Required for refer and decline (FAL 7 kap. 6 §). */
  reason: string;
  /**
   * For a diagnoses question: the rule applies only if a declared code is in
   * this list. Omitted: any yes.
   */
  onlyFor?: string[];
  /** For a rider: codes excluded besides the declared ones. Required for a boolean question. */
  diagnosisCodes?: string[];
  /** For a rider: its description on the policy, in the insurer's language. */
  riderDescription?: string;
}

/** What an underwriting author writes (ADR 0031). */
export interface UnderwritingContent {
  market: string;
  /**
   * Per species: the age on the start date of a new policy. minAgeDays: at
   * least this many days old. maxAgeYears: at most this age in whole years.
   * A species not listed is declined with 'species-not-covered'.
   */
  ageLimits: { species: string; minAgeDays: number; maxAgeYears?: number }[];
  questions: Question[];
  answerRules: AnswerRule[];
  /** Breeds that are referred or declined, e.g. for hereditary risks the insurer cannot price. */
  breedRules: { breed: string; outcome: 'refer' | 'decline'; reason: string }[];
}

/** Which rule set version decided, for the evidence. */
export interface UnderwritingRef {
  series: string;
  version: number;
  checksum: string;
}

export interface Answer {
  question: string;
  value: boolean;
  /** For a diagnoses question answered yes: the declared diagnoses. */
  diagnosisCodes?: string[];
}

export interface UnderwritingInput {
  market: string;
  species: string;
  /** Omitted: unknown breed. */
  breed?: string;
  birthDate: ISODate;
  /** The first day of the policy. */
  startDate: ISODate;
  answers: Answer[];
}

export interface Check {
  code: 'species' | 'min-age' | 'max-age' | 'breed' | 'answer';
  result: 'pass' | RuleOutcome;
  /** e.g. the age in days or years, the breed, or the question. */
  basis?: string | number;
  reason?: string;
}

/** A rider the application leads to. The policy module gives it an id and its dates. */
export interface RiderProposal {
  diagnosisCodes: string[];
  description: string;
  question: string;
  reason: string;
}

export interface UnderwritingResult {
  outcome: Outcome;
  riders: RiderProposal[];
  /** Reason codes for refer and decline, in the order the checks found them. */
  reasons: string[];
  checks: Check[];
  facts: { ageDays: number; ageYears: number };
  rules?: UnderwritingRef;
  /** sha256 over the rule set reference and the input; the same application gives the same hash. */
  inputHash: string;
}

export class UnderwritingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnderwritingError';
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[a-z][a-z0-9-]{1,63}$/;
const OUTCOMES: RuleOutcome[] = ['rider', 'refer', 'decline'];
const SEVERITY: Record<Outcome, number> = { accept: 0, 'accept-with-riders': 1, refer: 2, decline: 3 };

/** Whole years from birth to the date. Pure. */
export function ageInYears(birthDate: ISODate, onDate: ISODate): number {
  const [by, bm, bd] = birthDate.split('-').map(Number) as [number, number, number];
  const [y, m, d] = onDate.split('-').map(Number) as [number, number, number];
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

const daysBetween = (from: ISODate, to: ISODate) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** The questions the channel asks for a species, in the rule set's order. Pure. */
export function questionsFor(c: UnderwritingContent, species: string): Question[] {
  return c.questions.filter((q) => !q.species || q.species.includes(species));
}

/**
 * The outcome of an application (ADR 0031). The strictest wins: decline before
 * refer, refer before riders, riders before accept. Throws UnderwritingError
 * when the input does not fit the rules, e.g. a missing or unknown answer.
 */
export function underwrite(rules: { content: UnderwritingContent; ref?: UnderwritingRef }, input: UnderwritingInput): UnderwritingResult {
  const c = rules.content;
  const fail = (m: string): never => {
    throw new UnderwritingError(m);
  };
  if (input.market !== c.market) fail(`The underwriting rules are for ${c.market}, not ${input.market}`);
  if (!DATE.test(input.birthDate) || !DATE.test(input.startDate)) fail('birthDate and startDate must be YYYY-MM-DD');
  if (input.birthDate > input.startDate) fail('The animal is born after the start date');

  const asked = questionsFor(c, input.species);
  const answers = new Map<string, Answer>();
  for (const a of input.answers) {
    const q = asked.find((x) => x.id === a.question);
    if (!q) fail(`'${a.question}' is not a question for ${input.species}`);
    if (answers.has(a.question)) fail(`'${a.question}' is answered twice`);
    if (typeof a.value !== 'boolean') fail(`The answer to '${a.question}' must be true or false`);
    if (q!.type === 'boolean' && a.diagnosisCodes?.length) fail(`'${a.question}' takes no diagnosis codes`);
    if (q!.type === 'diagnoses' && a.value && !a.diagnosisCodes?.length) fail(`'${a.question}' answered yes needs the diagnosis codes`);
    if (!a.value && a.diagnosisCodes?.length) fail(`'${a.question}' answered no takes no diagnosis codes`);
    answers.set(a.question, a);
  }
  const missing = asked.filter((q) => !answers.has(q.id)).map((q) => q.id);
  if (missing.length) fail(`Unanswered questions: ${missing.join(', ')}`);

  const ageDays = daysBetween(input.birthDate, input.startDate);
  const ageYears = ageInYears(input.birthDate, input.startDate);
  const checks: Check[] = [];
  const riders: RiderProposal[] = [];

  const limits = c.ageLimits.find((l) => l.species === input.species);
  if (!limits) {
    checks.push({ code: 'species', result: 'decline', basis: input.species, reason: 'species-not-covered' });
  } else {
    checks.push({ code: 'species', result: 'pass', basis: input.species });
    checks.push(ageDays >= limits.minAgeDays ? { code: 'min-age', result: 'pass', basis: ageDays } : { code: 'min-age', result: 'decline', basis: ageDays, reason: 'too-young' });
    if (limits.maxAgeYears !== undefined) {
      checks.push(ageYears <= limits.maxAgeYears ? { code: 'max-age', result: 'pass', basis: ageYears } : { code: 'max-age', result: 'decline', basis: ageYears, reason: 'too-old' });
    }
  }

  const breedRule = input.breed ? c.breedRules.find((b) => b.breed === input.breed) : undefined;
  if (breedRule) checks.push({ code: 'breed', result: breedRule.outcome, basis: breedRule.breed, reason: breedRule.reason });

  for (const q of asked) {
    const a = answers.get(q.id)!;
    for (const r of c.answerRules.filter((x) => x.question === q.id)) {
      const declared = a.diagnosisCodes ?? [];
      const applies = a.value && (!r.onlyFor || declared.some((d) => r.onlyFor!.includes(d)));
      if (!applies) continue;
      checks.push({ code: 'answer', result: r.outcome, basis: q.id, reason: r.reason });
      if (r.outcome === 'rider') {
        const codes = [...new Set([...(q.type === 'diagnoses' ? declared : []), ...(r.diagnosisCodes ?? [])])].sort();
        riders.push({ diagnosisCodes: codes, description: r.riderDescription!, question: q.id, reason: r.reason });
      }
    }
    if (!checks.some((x) => x.code === 'answer' && x.basis === q.id)) checks.push({ code: 'answer', result: 'pass', basis: q.id });
  }

  let outcome: Outcome = 'accept';
  for (const x of checks) {
    const o: Outcome = x.result === 'pass' ? 'accept' : x.result === 'rider' ? 'accept-with-riders' : x.result;
    if (SEVERITY[o] > SEVERITY[outcome]) outcome = o;
  }
  const reasons = [...new Set(checks.filter((x) => x.result === 'refer' || x.result === 'decline').map((x) => x.reason!))];

  const normalized = {
    market: input.market,
    species: input.species,
    breed: input.breed,
    birthDate: input.birthDate,
    startDate: input.startDate,
    answers: [...answers.values()]
      .map((a) => ({ question: a.question, value: a.value, diagnosisCodes: a.diagnosisCodes?.length ? [...a.diagnosisCodes].sort() : undefined }))
      .sort((x, y) => (x.question < y.question ? -1 : 1)),
  };
  const inputHash = createHash('sha256').update(canonicalJson({ rules: rules.ref, input: normalized })).digest('hex');
  return { outcome, riders, reasons, checks, facts: { ageDays, ageYears }, ...(rules.ref ? { rules: rules.ref } : {}), inputHash };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** What is wrong with underwriting rules, if anything. Empty: valid. Pure. */
export function validateUnderwriting(c: UnderwritingContent): string[] {
  const errors: string[] = [];
  const fail = (m: string) => errors.push(m);
  const codes = (v: unknown) => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string' && x.length > 0);
  if (!c || typeof c !== 'object') return ['The underwriting rules must be an object'];
  if (!/^[A-Z]{2}$/.test(c.market ?? '')) fail(`Invalid market '${c.market}'`);

  if (!Array.isArray(c.ageLimits) || c.ageLimits.length === 0) fail('At least one species needs age limits');
  const species = new Set<string>();
  for (const l of c.ageLimits ?? []) {
    if (!l.species) fail('An age limit needs a species');
    if (species.has(l.species)) fail(`The age limits for ${l.species} are listed twice`);
    species.add(l.species);
    if (!Number.isSafeInteger(l.minAgeDays) || l.minAgeDays < 0) fail(`minAgeDays for ${l.species} must be a non-negative integer`);
    if (l.maxAgeYears !== undefined && (!Number.isSafeInteger(l.maxAgeYears) || l.maxAgeYears < 0)) fail(`maxAgeYears for ${l.species} must be a non-negative integer`);
  }

  if (!Array.isArray(c.questions)) fail('questions must be a list');
  const questions = new Map<string, Question>();
  for (const q of c.questions ?? []) {
    if (!ID.test(q.id ?? '')) fail(`Invalid question id '${q.id}': lower-case letters, digits and hyphens`);
    if (questions.has(q.id)) fail(`The question ${q.id} is listed twice`);
    questions.set(q.id, q);
    if (q.type !== 'boolean' && q.type !== 'diagnoses') fail(`The question ${q.id} has an unknown type '${q.type}'`);
    const labels = Object.entries(q.labels ?? {});
    if (labels.length === 0 || labels.some(([lang, text]) => !/^[a-z]{2}$/.test(lang) || typeof text !== 'string' || !text.trim())) {
      fail(`The question ${q.id} needs a text per language, e.g. { "en": "…" }`);
    }
    if (q.species !== undefined && !codes(q.species)) fail(`The question ${q.id}: species must be a non-empty list`);
  }

  if (!Array.isArray(c.answerRules)) fail('answerRules must be a list');
  for (const r of c.answerRules ?? []) {
    const q = questions.get(r.question);
    if (!q) fail(`An answer rule refers to the unknown question '${r.question}'`);
    if (!OUTCOMES.includes(r.outcome)) fail(`The rule for ${r.question} has an unknown outcome '${r.outcome}'`);
    if (!ID.test(r.reason ?? '')) fail(`The rule for ${r.question} needs a reason code: lower-case letters, digits and hyphens`);
    if (r.onlyFor !== undefined && (!codes(r.onlyFor) || q?.type !== 'diagnoses')) fail(`The rule for ${r.question}: onlyFor needs a diagnoses question and a non-empty list`);
    if (r.diagnosisCodes !== undefined && !codes(r.diagnosisCodes)) fail(`The rule for ${r.question}: diagnosisCodes must be a non-empty list`);
    if (r.outcome === 'rider') {
      if (!r.riderDescription?.trim()) fail(`The rider for ${r.question} needs riderDescription`);
      if (q?.type === 'boolean' && !r.diagnosisCodes) fail(`The rider for the yes-or-no question ${r.question} needs diagnosisCodes`);
    } else if (r.diagnosisCodes !== undefined || r.riderDescription !== undefined) {
      fail(`The rule for ${r.question}: diagnosisCodes and riderDescription are only for a rider`);
    }
  }

  if (!Array.isArray(c.breedRules)) fail('breedRules must be a list');
  const breeds = new Set<string>();
  for (const b of c.breedRules ?? []) {
    if (!b.breed) fail('A breed rule needs a breed');
    if (breeds.has(b.breed)) fail(`The breed ${b.breed} is listed twice`);
    breeds.add(b.breed);
    if (b.outcome !== 'refer' && b.outcome !== 'decline') fail(`The breed ${b.breed} has an unknown outcome '${b.outcome}'`);
    if (!ID.test(b.reason ?? '')) fail(`The breed ${b.breed} needs a reason code`);
  }

  const known = new Set(['market', 'ageLimits', 'questions', 'answerRules', 'breedRules']);
  for (const k of Object.keys(c)) if (!known.has(k)) fail(`Unknown field '${k}' in the underwriting rules`);
  return errors;
}

/**
 * What the rules cannot decide for a product: a species the product covers
 * without age limits, or another market. Empty: the rules cover the product. Pure.
 */
export function underwritingCoverage(c: UnderwritingContent, product: { market: string; species: string[] }): string[] {
  const out: string[] = [];
  if (c.market !== product.market) out.push(`The underwriting rules are for ${c.market}, the product for ${product.market}`);
  for (const s of product.species) if (!c.ageLimits.some((l) => l.species === s)) out.push(`No age limits for ${s}`);
  return out;
}
