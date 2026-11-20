/**
 * Issuing and changing policies in the back office (ADR 0029, 0031): the
 * forms, what is missing and the bodies. A product with a tariff is priced by
 * Petvold; without one the person gives the premium for a term. A product with
 * underwriting rules takes an application instead. Pure; tested with node:test.
 */
import { toMinorUnits } from './settings-logic.ts';

export interface ProductLike {
  id: string;
  content: {
    market: string;
    currency: string;
    species: string[];
    tariffSeries?: string;
    underwritingSeries?: string;
    vetCare: { annualLimits: number[]; defaultAnnualLimit?: number; deductibles: { code: string; labels?: Record<string, string> }[]; defaultDeductible?: string };
    documents?: { type: 'terms' | 'pre-contract' | 'ipid'; language: string; sha256: string }[];
    policy?: { maxStartAheadDays?: number };
  };
}

export interface IssueForm {
  market: string;
  animalId: string;
  policyholderPartyId: string;
  productVersion: string;
  startDate: string;
  annualLimit: number | null;
  deductible: string;
  campaignCode: string;
  /** In major units as typed, only for a product without a tariff. */
  premium: string;
  channel: string;
  reference: string;
  /** datetime-local, the customer's acceptance as the channel says. */
  acceptedAt: string;
  /** Documents shown, as "type:language". */
  documents: string[];
}

export const CHANNELS = ['phone', 'paper', 'web', 'app'] as const;

export const emptyIssue = (today: string, now: string, o: { animalId?: string; holder?: string } = {}): IssueForm => ({
  market: 'SE',
  animalId: o.animalId ?? '',
  policyholderPartyId: o.holder ?? '',
  productVersion: '',
  startDate: today,
  annualLimit: null,
  deductible: '',
  campaignCode: '',
  premium: '',
  channel: 'phone',
  reference: '',
  acceptedAt: now,
  documents: [],
});

/** The product's choices as the form's defaults. */
export function withProductDefaults(f: IssueForm, p: ProductLike): IssueForm {
  const v = p.content.vetCare;
  return {
    ...f,
    productVersion: p.id,
    annualLimit: v.defaultAnnualLimit ?? v.annualLimits[0] ?? null,
    deductible: v.defaultDeductible ?? v.deductibles[0]?.code ?? '',
    documents: [],
  };
}

/** Whether the product needs an application with health questions instead of issuing directly. */
export const needsApplication = (p: ProductLike | null): boolean => !!p?.content.underwritingSeries;

/** What issuing is missing, as message ids. */
/** The last day a new policy of the product may start: the product's maxStartAheadDays after today, 90 by default. */
export function latestStart(p: ProductLike, today: string): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + (p.content.policy?.maxStartAheadDays ?? 90));
  return d.toISOString().slice(0, 10);
}

export function issueProblems(f: IssueForm, p: ProductLike | null, today: string, now: string): string[] {
  const out: string[] = [];
  if (!/^ani_[A-Za-z0-9]+$/.test(f.animalId.trim())) out.push('policy.needAnimal');
  if (!/^pty_[A-Za-z0-9]{1,64}$/.test(f.policyholderPartyId.trim())) out.push('policy.needHolder');
  if (!p) out.push('policy.needProduct');
  if (!f.startDate) out.push('policy.needStart');
  else if (f.startDate < today) out.push('application.startInPast');
  else if (p && f.startDate > latestStart(p, today)) out.push('policy.startTooFar');
  if (p && !p.content.tariffSeries && toMinorUnits(f.premium, p.content.currency) === null) out.push('policy.needPremium');
  if (!f.channel.trim()) out.push('policy.needChannel');
  if (!f.acceptedAt || f.acceptedAt > now) out.push('policy.badAcceptedAt');
  const docs = p?.content.documents ?? [];
  if (docs.length) {
    const shown = new Set(f.documents.map((d) => d.split(':')[0]));
    if (!shown.has('terms') || !shown.has('pre-contract')) out.push('policy.needDocuments');
  }
  return out;
}

/** The body for POST /v1/quotes, for the price before issuing. */
export function quoteBody(f: IssueForm, p: ProductLike) {
  return {
    market: p.content.market,
    productVersion: p.id,
    startDate: f.startDate,
    animalId: f.animalId.trim(),
    policyholderPartyId: f.policyholderPartyId.trim(),
    vetCare: { ...(f.annualLimit !== null ? { annualLimit: f.annualLimit } : {}), ...(f.deductible ? { deductible: f.deductible } : {}) },
    ...(f.campaignCode.trim() ? { campaignCode: f.campaignCode.trim().toUpperCase() } : {}),
  };
}

/** The body for POST /v1/policies. `acceptedAt` from datetime-local is read in the browser's time zone. */
export function issueBody(f: IssueForm, p: ProductLike) {
  const docs = (p.content.documents ?? []).filter((d) => f.documents.includes(`${d.type}:${d.language}`));
  const premium = p.content.tariffSeries ? null : toMinorUnits(f.premium, p.content.currency);
  return {
    market: p.content.market,
    animalId: f.animalId.trim(),
    policyholderPartyId: f.policyholderPartyId.trim(),
    productVersion: p.id,
    startDate: f.startDate,
    vetCare: { ...(f.annualLimit !== null ? { annualLimit: f.annualLimit } : {}), ...(f.deductible ? { deductible: f.deductible } : {}) },
    ...(premium !== null ? { premium: { amount: premium, currency: p.content.currency } } : {}),
    ...(f.campaignCode.trim() ? { campaignCode: f.campaignCode.trim().toUpperCase() } : {}),
    acceptance: {
      channel: f.channel.trim(),
      ...(f.reference.trim() ? { reference: f.reference.trim() } : {}),
      acceptedAt: new Date(f.acceptedAt).toISOString(),
      ...(docs.length ? { documents: docs.map((d) => ({ type: d.type, language: d.language, sha256: d.sha256 })) } : {}),
    },
  };
}

export const CANCELLATION_REASONS = ['customer-term-end', 'customer-immediate', 'withdrawal', 'need-ceased', 'insurer-term-end', 'insurer-breach', 'unpaid-premium'] as const;
export type CancellationReason = (typeof CANCELLATION_REASONS)[number];

export interface CancelForm {
  reason: CancellationReason | '';
  receivedOn: string;
  effectiveDate: string;
  note: string;
}

/** What a cancellation is missing: need-ceased needs the day and a note; a breach needs a note. */
export function cancelProblems(f: CancelForm, today: string): string[] {
  const out: string[] = [];
  if (!f.reason) out.push('policy.needCancelReason');
  if (f.receivedOn && f.receivedOn > today) out.push('policy.futureReceived');
  if (f.reason === 'need-ceased' && !f.effectiveDate) out.push('policy.needEffective');
  if ((f.reason === 'need-ceased' || f.reason === 'insurer-breach') && !f.note.trim()) out.push('policy.needNote');
  return out;
}

export function cancelBody(f: CancelForm) {
  return {
    reason: f.reason as CancellationReason,
    ...(f.receivedOn ? { receivedOn: f.receivedOn } : {}),
    ...(f.effectiveDate && (f.reason === 'need-ceased' || f.reason === 'customer-immediate') ? { effectiveDate: f.effectiveDate } : {}),
    ...(f.note.trim() ? { note: f.note.trim() } : {}),
  };
}

export interface ChangeForm {
  from: string;
  annualLimit: number | null;
  deductible: string;
  premium: string;
  reason: string;
}

/** What a change of choices is missing: from today, a reason, and a premium without a tariff. */
export function changeProblems(f: ChangeForm, today: string, priced: boolean, currency: string): string[] {
  const out: string[] = [];
  if (!f.from || f.from < today) out.push('policy.changeFrom');
  if (!priced && toMinorUnits(f.premium, currency) === null) out.push('policy.needPremium');
  if (!f.reason.trim()) out.push('settings.needReason');
  return out;
}

export function changeBody(f: ChangeForm, priced: boolean, currency: string) {
  const premium = priced ? null : toMinorUnits(f.premium, currency);
  return {
    from: f.from,
    vetCare: { ...(f.annualLimit !== null ? { annualLimit: f.annualLimit } : {}), ...(f.deductible ? { deductible: f.deductible } : {}) },
    ...(premium !== null ? { premium: { amount: premium, currency } } : {}),
    reason: f.reason.trim(),
  };
}

/** The latest transaction is a cancellation: only then may it be reversed. */
export function reversibleCancellation<T extends { id: string; type: string; requestedAt: string }>(transactions: T[]): T | undefined {
  const latest = [...transactions].sort((a, b) => (a.requestedAt < b.requestedAt ? -1 : a.requestedAt > b.requestedAt ? 1 : 0)).at(-1);
  return latest?.type === 'cancel' ? latest : undefined;
}

/** An answer to one underwriting question (ADR 0031): yes or no, and for a diagnoses question answered yes the codes. */
export interface AnswerForm {
  question: string;
  type: 'boolean' | 'diagnoses';
  value: boolean | null;
  /** Comma or space separated diagnosis codes, for a diagnoses question answered yes. */
  diagnoses: string;
}

export const answersFor = (questions: { id: string; type: 'boolean' | 'diagnoses' }[]): AnswerForm[] =>
  questions.map((q) => ({ question: q.id, type: q.type, value: null, diagnoses: '' }));

const codes = (s: string) => s.split(/[\s,]+/).map((c) => c.trim().toUpperCase()).filter(Boolean);

/** What the answers are missing: every question answered, and diagnoses named when declared. */
export function answerProblems(answers: AnswerForm[]): string[] {
  const out: string[] = [];
  if (answers.some((a) => a.value === null)) out.push('policy.needAnswers');
  if (answers.some((a) => a.type === 'diagnoses' && a.value === true && !codes(a.diagnoses).length)) out.push('policy.needDiagnoses');
  return out;
}

/** The answers as the API takes them. */
export function answersBody(answers: AnswerForm[]) {
  return answers
    .filter((a) => a.value !== null)
    .map((a) => ({ question: a.question, value: a.value as boolean, ...(a.type === 'diagnoses' && a.value && codes(a.diagnoses).length ? { diagnosisCodes: codes(a.diagnoses) } : {}) }));
}

/** The body for POST /v1/applications: the same as issuing, with the answers. */
export function applicationBody(f: IssueForm, p: ProductLike, answers: AnswerForm[]) {
  return { ...issueBody(f, p), answers: answersBody(answers) };
}
