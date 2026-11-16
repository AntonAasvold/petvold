/**
 * Notices to the customer (ADR 0032).
 *
 * Petvold decides what the customer must be told, when it must be sent at the
 * latest and what it must contain. The insurer's document system makes the
 * document from its templates, sends it and reports back. A notice is that
 * task: its type, recipient, content as fields, legal basis and due date.
 *
 * Notices are made from other modules' events, through the relay (ADR 0008),
 * and read what they need through ports, never other modules' tables (ADR
 * 0001). The same event never gives two notices of a type. A notice never
 * changes: deliveries are added to it, and a resend is another delivery.
 */
import { addDays, marketDate, marketLanguage } from '@petvold/common';

export type ISODate = string;
export type Timestamp = string;

export const NOTICE_TYPES = ['policy-confirmation', 'renewal-notice', 'insurer-termination', 'cancellation-confirmation', 'application-declined', 'transfer-offer'] as const;
export type NoticeType = (typeof NOTICE_TYPES)[number];

/** The content schema of each type. A new legal requirement gives a new field or version. */
export const NOTICE_SCHEMAS: Record<NoticeType, string> = {
  'policy-confirmation': 'policy-confirmation.v1',
  'renewal-notice': 'renewal-notice.v1',
  'insurer-termination': 'insurer-termination.v1',
  'cancellation-confirmation': 'cancellation-confirmation.v1',
  'application-declined': 'application-declined.v1',
  'transfer-offer': 'transfer-offer.v1',
};

/** Fields an insurer's text fills, per type: a notice without them is incomplete and in the queue. */
export const REQUIRED_TEXTS: Partial<Record<NoticeType, (keyof NoticeTexts)[]>> = {
  // Chapter 7 section 6: what the applicant must do to have the decision reviewed.
  'application-declined': ['review'],
};

/**
 * When a notice must be sent at the latest:
 * - promptly: the event's date plus the market's `promptlyDays`
 * - term-start: the first day of the new term
 * - sent-on: the day the insurer says it sent the notice, which the law counts from
 */
export type DueRule = 'promptly' | 'term-start' | 'sent-on';

export interface NoticeRule {
  /** Required by law: cannot be turned off. */
  required: boolean;
  due: DueRule;
  /** The provisions, in English, for the notice and the insurer's document system. */
  legalBasis: string[];
}

export interface MarketNoticeRules {
  /**
   * Days that "promptly" (snarast) gives. The law sets no number; this is
   * Petvold's default until the insurer's settings replace it (ADR 0032).
   */
  promptlyDays: number;
  types: Record<NoticeType, NoticeRule>;
}

/** The law per market, with sources. A market missing here gets no notices. */
export const NOTICE_RULES: Record<string, MarketNoticeRules> = {
  SE: {
    promptlyDays: 3,
    types: {
      'policy-confirmation': {
        required: true,
        due: 'promptly',
        legalBasis: [
          'Insurance Contracts Act (2005:104) chapter 2 section 4: written confirmation of the contract, promptly',
          'Distance Contracts Act (2005:59) chapter 3 section 11: the information and terms promptly after a contract by telephone',
        ],
      },
      'renewal-notice': {
        required: true,
        due: 'term-start',
        legalBasis: [
          'Insurance Contracts Act chapter 2 sections 5-6: information during the term',
          'Insurance Contracts Act chapter 3 section 5: changed terms at renewal in writing, at the latest with the demand for premium',
        ],
      },
      'insurer-termination': {
        required: true,
        due: 'sent-on',
        legalBasis: [
          'Insurance Contracts Act chapter 3 section 3: the insurer gives notice at the end of the term in writing, at least a month before',
          'Insurance Contracts Act chapter 3 section 7: the insurer may cancel during the term in writing, fourteen days after sending',
          'Insurance Contracts Act chapter 5 section 2: for unpaid premium, with the statement that the cancellation has no effect if the premium is paid within fourteen days of sending',
        ],
      },
      'cancellation-confirmation': { required: false, due: 'promptly', legalBasis: [] },
      // The new owner of a sold animal may take over the policy (ADR 0029); the law does not require the offer.
      'transfer-offer': { required: false, due: 'promptly', legalBasis: [] },
      'application-declined': {
        required: true,
        due: 'promptly',
        legalBasis: ['Insurance Contracts Act chapter 7 section 6: a refusal states the reasons and what the applicant must do to have the decision reviewed'],
      },
    },
  },
};

export const DELIVERY_CHANNELS = ['letter', 'email', 'digital-mailbox', 'customer-portal'] as const;
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];

/** A report from the document system. Never changes; a resend is another delivery. */
export interface Delivery {
  id: string;
  outcome: 'sent' | 'failed';
  /** sent: how it reached the customer. */
  channel?: DeliveryChannel;
  /** sent: when it was sent, as the document system says. */
  sentAt?: Timestamp;
  /** sent: the document's id in the insurer's archive. */
  documentId?: string;
  /** sent: sha256 of the document's bytes. */
  sha256?: string;
  /** failed: why, e.g. a missing address. Must not contain personal data. */
  reason?: string;
  reportedBy: string;
  reportedAt: Timestamp;
}

/** The insurer's texts in one language (ADR 0032). */
export interface NoticeTexts {
  /** Who the notice is from, e.g. the insurer's name and contact details. */
  sender?: string;
  /** How a decision is reviewed: the insurer's complaints function and the bodies the customer can turn to. */
  review?: string;
}

/** The insurer's choices for a market. Laws cannot be weakened: required types cannot be turned off. */
export interface MarketNoticeSettings {
  /** Days that "promptly" gives, 1-30. Omitted: the market rules' default. */
  promptlyDays?: number;
  /** Types the law does not require that the insurer does not want. */
  disabledTypes?: NoticeType[];
  /** Language (ISO 639-1) -> texts. */
  texts?: Record<string, NoticeTexts>;
}

export interface NoticeSettings {
  /** 1, 2, 3 … Version 1 comes from the installation's defaults. */
  version: number;
  markets: Record<string, MarketNoticeSettings>;
  changedBy: string;
  changedAt: Timestamp;
  reason: string;
}

export interface NoticeSettingsStore {
  current(): Promise<NoticeSettings | null>;
  /** Oldest first. */
  versions(): Promise<NoticeSettings[]>;
  /** Throws NoticeConflictError unless it is the next version. */
  append(s: NoticeSettings): Promise<void>;
}

export interface Notice {
  id: string;
  type: NoticeType;
  /** The content schema, e.g. renewal-notice.v1. */
  schema: string;
  market: string;
  /** The party the notice is for. The document system reads name and address from the party when it sends. */
  recipientPartyId: string;
  /** ISO 639-1: the party's language, else the market's. */
  language: string;
  policyId?: string;
  applicationId?: string;
  /** The event it was made from. Together with the type, unique. */
  source: { eventId: string; eventType: string; occurredAt: Timestamp };
  legalBasis: string[];
  /** The last day to send it. */
  dueBy: ISODate;
  /** What the law requires as fields, per schema. No names or addresses. */
  content: Record<string, unknown>;
  /** The version of the insurer's settings it was made with. Omitted: made before settings existed (migration 0032). */
  settingsVersion?: number;
  createdAt: Timestamp;
  deliveries: Delivery[];
}

export type NoticeStatus = 'pending' | 'sent' | 'failed';

/** A notice as read: with its status and flags at the time of reading. */
export interface NoticeView extends Notice {
  /** sent once any delivery was sent; failed if every delivery failed; else pending. */
  status: NoticeStatus;
  /** The first sending was after dueBy, in the market's days. For a termination, a person should check the effective date. */
  late?: boolean;
  /** Not sent and dueBy has passed. */
  overdue?: boolean;
  /** Texts the insurer's settings lacked when it was made, e.g. review. The document system cannot send it as it is. */
  incomplete?: string[];
}

/** An event from another module, as the relay hands it over. */
export interface SourceEvent {
  id: string;
  type: string;
  policyId?: string;
  applicationId?: string;
  occurredAt: Timestamp;
  data: Record<string, unknown>;
}

export interface TermView {
  termNo: number;
  startDate: ISODate;
  endDate: ISODate;
  productVersion: string;
  currency: string;
  premium: number;
  vetCare: unknown;
  deductibleOption: string;
  riders: { description: string; diagnosisCodes: string[]; validFrom: ISODate }[];
}

export interface PolicyView {
  id: string;
  market: string;
  animalId: string;
  terms: TermView[];
  /** The versions as known now. */
  versions: { validFrom: ISODate; validTo: ISODate; policyholderPartyId: string; status: string }[];
}

export interface TransactionView {
  type: string;
  cancellation?: { reason: string; receivedOn: ISODate; effectiveDate: ISODate; refund: { amount: number; currency: string }; note?: string };
  /** The documents the customer accepted at issue (ADR 0032). */
  acceptedDocuments?: { type: string; language: string; sha256: string }[];
}

export interface ProposalView {
  id: string;
  kind: string;
  fromPartyId: string;
  toPartyId: string;
  /** The day the new owner took over the animal. */
  from: ISODate;
  /** The last day to accept. */
  deadline: ISODate;
}

export interface ApplicationView {
  id: string;
  market: string;
  animalId: string;
  policyholderPartyId: string;
  productVersion: string;
  /** Reason codes: the rules' or the person's. */
  reasons: string[];
  decidedBy: 'rules' | 'person';
}

/** What the module reads from the policy module. */
export interface PolicySource {
  policy(policyId: string): Promise<PolicyView | null>;
  transaction(policyId: string, transactionId: string): Promise<TransactionView | null>;
  application(applicationId: string): Promise<ApplicationView | null>;
  proposal(proposalId: string): Promise<ProposalView | null>;
}

/** What the module reads from the parties module. */
export interface PartySource {
  /** The party's preferred language, if any. */
  languageOf(partyId: string): Promise<string | undefined>;
}

export interface NoticeFilter {
  status?: NoticeStatus;
  type?: NoticeType;
  market?: string;
  policyId?: string;
  applicationId?: string;
  recipientPartyId?: string;
}

export interface NoticeStore {
  /** false if the source event already gave a notice of the type. */
  add(n: Notice): Promise<boolean>;
  get(id: string): Promise<Notice | null>;
  /** Oldest first. */
  list(filter: NoticeFilter): Promise<Notice[]>;
  /** Throws NoticeConflictError if the notice does not exist. */
  addDelivery(noticeId: string, d: Delivery): Promise<void>;
}

export class NoticeConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoticeConflictError';
  }
}

export type CommunicationsErrorCode = 'validation' | 'not_found' | 'conflict';

export class CommunicationsError extends Error {
  constructor(
    public readonly code: CommunicationsErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CommunicationsError';
  }
}

export interface DeliveryInput {
  outcome: 'sent' | 'failed';
  channel?: string;
  sentAt?: Timestamp;
  documentId?: string;
  sha256?: string;
  reason?: string;
}

export interface CommunicationsDeps {
  store: NoticeStore;
  policies: PolicySource;
  parties: PartySource;
  clock: { now(): Timestamp };
  ids: { next(prefix: string): string };
  /** The insurer's versioned settings. */
  settings: NoticeSettingsStore;
  /** Defaults to NOTICE_RULES. */
  rules?: Record<string, MarketNoticeRules>;
  /** Version 1 of the settings. Defaults to an empty setting per market with rules. */
  defaults?: Record<string, MarketNoticeSettings>;
}

const INSURER_REASONS = new Set(['insurer-term-end', 'insurer-breach', 'unpaid-premium']);

/** The status and flags of a notice at a point in time. Pure. */
export function viewOf(n: Notice, now: Timestamp): NoticeView {
  const sent = n.deliveries.find((d) => d.outcome === 'sent');
  const status: NoticeStatus = sent ? 'sent' : n.deliveries.length ? 'failed' : 'pending';
  const late = sent ? marketDate(n.market, sent.sentAt!) > n.dueBy : false;
  const overdue = !sent && marketDate(n.market, now) > n.dueBy;
  const incomplete = (REQUIRED_TEXTS[n.type] ?? []).filter((k) => typeof n.content[k] !== 'string');
  return { ...structuredClone(n), status, ...(late ? { late } : {}), ...(overdue ? { overdue } : {}), ...(incomplete.length ? { incomplete } : {}) };
}

export class CommunicationsService {
  constructor(private readonly d: CommunicationsDeps) {}

  private rulesFor(market: string): MarketNoticeRules | undefined {
    return (this.d.rules ?? NOTICE_RULES)[market];
  }

  /**
   * Makes the notice an event calls for, if any. Repeats of an event give
   * nothing new, so the relay may deliver it more than once. Returns the new
   * notice, or null.
   */
  async handlePolicyEvent(e: SourceEvent): Promise<Notice | null> {
    const planned = await this.plan(e);
    if (!planned) return null;
    const rules = this.rulesFor(planned.market);
    if (!rules) return null;
    const rule = rules.types[planned.type];
    const settings = await this.settings();
    const ms = settings.markets[planned.market] ?? {};
    if (!rule.required && ms.disabledTypes?.includes(planned.type)) return null;
    const language = (await this.d.parties.languageOf(planned.recipientPartyId)) ?? marketLanguage(planned.market) ?? 'en';
    // The texts in the notice's language, else the market's.
    const texts = ms.texts?.[language] ?? ms.texts?.[marketLanguage(planned.market) ?? ''] ?? {};
    const eventDate = marketDate(planned.market, e.occurredAt);
    const dueBy =
      rule.due === 'promptly' ? addDays(eventDate, ms.promptlyDays ?? rules.promptlyDays) : rule.due === 'term-start' ? planned.termStart! : planned.sentOn!;
    const wanted = new Set<string>(['sender', ...(REQUIRED_TEXTS[planned.type] ?? [])]);
    const fromSettings = Object.fromEntries(Object.entries(texts).filter(([k, v]) => wanted.has(k) && v));
    const notice: Notice = {
      id: this.d.ids.next('ntc'),
      type: planned.type,
      schema: NOTICE_SCHEMAS[planned.type],
      market: planned.market,
      recipientPartyId: planned.recipientPartyId,
      language,
      ...(planned.policyId ? { policyId: planned.policyId } : {}),
      ...(planned.applicationId ? { applicationId: planned.applicationId } : {}),
      source: { eventId: e.id, eventType: e.type, occurredAt: e.occurredAt },
      legalBasis: [...rule.legalBasis],
      dueBy,
      content: { ...planned.content, ...fromSettings },
      settingsVersion: settings.version,
      createdAt: this.d.clock.now(),
      deliveries: [],
    };
    return (await this.d.store.add(notice)) ? notice : null;
  }

  /** What notice an event calls for, read through the ports. */
  private async plan(e: SourceEvent): Promise<
    | {
        type: NoticeType;
        market: string;
        recipientPartyId: string;
        policyId?: string;
        applicationId?: string;
        content: Record<string, unknown>;
        termStart?: ISODate;
        sentOn?: ISODate;
      }
    | null
  > {
    if (e.type === 'application.declined') {
      const a = await this.d.policies.application(e.applicationId ?? '');
      if (!a) throw new Error(`The application ${e.applicationId} of event ${e.id} does not exist`);
      return {
        type: 'application-declined',
        market: a.market,
        recipientPartyId: a.policyholderPartyId,
        applicationId: a.id,
        content: { applicationId: a.id, animalId: a.animalId, productVersion: a.productVersion, reasons: [...a.reasons], decidedBy: a.decidedBy },
      };
    }
    if (!e.policyId || !['policy.issued', 'policy.renewed', 'policy.cancelled', 'proposal.created'].includes(e.type)) return null;
    if (e.type === 'proposal.created' && e.data.kind !== 'transfer') return null;
    const p = await this.d.policies.policy(e.policyId);
    if (!p) throw new Error(`The policy ${e.policyId} of event ${e.id} does not exist`);
    const txId = String(e.data.transactionId ?? '');

    if (e.type === 'policy.issued') {
      const term = p.terms[0]!;
      const tx = await this.d.policies.transaction(p.id, txId);
      return {
        type: 'policy-confirmation',
        market: p.market,
        recipientPartyId: holderOn(p, term.startDate),
        policyId: p.id,
        content: {
          policyId: p.id,
          animalId: p.animalId,
          ...termContent(term),
          acceptedDocuments: structuredClone(tx?.acceptedDocuments ?? []),
        },
      };
    }

    if (e.type === 'policy.renewed') {
      const termNo = Number(e.data.termNo);
      const term = p.terms.find((t) => t.termNo === termNo);
      if (!term) throw new Error(`The policy ${p.id} has no term ${termNo}`);
      const previous = p.terms.find((t) => t.termNo === termNo - 1);
      const changes = previous ? changesBetween(previous, term) : [];
      return {
        type: 'renewal-notice',
        market: p.market,
        recipientPartyId: holderOn(p, term.startDate),
        policyId: p.id,
        termStart: term.startDate,
        content: {
          policyId: p.id,
          animalId: p.animalId,
          ...termContent(term),
          changes,
          ...(previous ? { previous: { productVersion: previous.productVersion, premium: { amount: previous.premium, currency: previous.currency }, vetCare: structuredClone(previous.vetCare), deductibleOption: previous.deductibleOption } } : {}),
        },
      };
    }

    if (e.type === 'proposal.created') {
      const pr = await this.d.policies.proposal(String(e.data.proposalId ?? ''));
      if (!pr) throw new Error(`The proposal ${e.data.proposalId} of event ${e.id} does not exist`);
      const term = p.terms.find((t) => t.startDate <= pr.from && pr.from < t.endDate) ?? p.terms.at(-1)!;
      return {
        type: 'transfer-offer',
        market: p.market,
        recipientPartyId: pr.toPartyId,
        policyId: p.id,
        content: {
          policyId: p.id,
          animalId: p.animalId,
          proposalId: pr.id,
          fromPartyId: pr.fromPartyId,
          from: pr.from,
          deadline: pr.deadline,
          ...termContent(term),
        },
      };
    }

    // policy.cancelled
    const tx = await this.d.policies.transaction(p.id, txId);
    const c = tx?.cancellation;
    if (!c) throw new Error(`The cancellation ${txId} of policy ${p.id} does not exist`);
    const insurer = INSURER_REASONS.has(c.reason);
    // The policyholder on the last day the policy applied.
    const recipientPartyId = holderOn(p, addDays(c.effectiveDate, -1));
    const content: Record<string, unknown> = {
      policyId: p.id,
      animalId: p.animalId,
      reason: c.reason,
      receivedOn: c.receivedOn,
      effectiveDate: c.effectiveDate,
      refund: { ...c.refund },
      ...(insurer && c.note ? { grounds: c.note } : {}),
      // Chapter 5 section 2: no effect if the premium is paid before the effective date.
      ...(c.reason === 'unpaid-premium' ? { voidIfPaidBefore: c.effectiveDate } : {}),
    };
    return insurer
      ? { type: 'insurer-termination', market: p.market, recipientPartyId, policyId: p.id, sentOn: c.receivedOn, content }
      : { type: 'cancellation-confirmation', market: p.market, recipientPartyId, policyId: p.id, content };
  }

  /** The insurer's settings in force. Version 1 is stored the first time, from the defaults. */
  async settings(): Promise<NoticeSettings> {
    const cur = await this.d.settings.current();
    if (cur) return cur;
    const markets = this.d.defaults ?? Object.fromEntries(Object.keys(this.d.rules ?? NOTICE_RULES).map((m) => [m, {}]));
    const first: NoticeSettings = { version: 1, markets: structuredClone(markets), changedBy: 'petvold-defaults', changedAt: this.d.clock.now(), reason: 'Petvold default notice settings (ADR 0032)' };
    await this.d.settings.append(first).catch((e: unknown) => {
      if (!(e instanceof NoticeConflictError)) throw e; // someone else stored version 1 first
    });
    return (await this.d.settings.current())!;
  }

  async settingsVersions(): Promise<NoticeSettings[]> {
    await this.settings();
    return this.d.settings.versions();
  }

  /** A new version of the settings, based on the one in force. */
  async changeSettings(input: { markets: Record<string, MarketNoticeSettings>; basedOnVersion: number; reason: string }, by: string): Promise<NoticeSettings> {
    const cur = await this.settings();
    if (cur.version !== input.basedOnVersion) throw new CommunicationsError('conflict', `The notice settings are at version ${cur.version}, not ${input.basedOnVersion}`);
    const reason = (input.reason ?? '').trim();
    const fail = (m: string): never => {
      throw new CommunicationsError('validation', m);
    };
    if (!reason) fail('A reason is required');
    const markets: Record<string, MarketNoticeSettings> = {};
    for (const [market, s] of Object.entries(input.markets ?? {})) {
      const rules = this.rulesFor(market);
      if (!rules) fail(`Petvold has no notice rules for '${market}'`);
      const out: MarketNoticeSettings = {};
      if (s.promptlyDays !== undefined) {
        if (!Number.isInteger(s.promptlyDays) || s.promptlyDays < 1 || s.promptlyDays > 30) fail(`promptlyDays for ${market} must be 1-30`);
        out.promptlyDays = s.promptlyDays;
      }
      if (s.disabledTypes !== undefined) {
        for (const t of s.disabledTypes) {
          if (!(NOTICE_TYPES as readonly string[]).includes(t)) fail(`Unknown notice type '${t}'`);
          if (rules!.types[t].required) fail(`${t} is required by law in ${market} and cannot be turned off`);
        }
        out.disabledTypes = [...new Set(s.disabledTypes)].sort();
      }
      if (s.texts !== undefined) {
        out.texts = {};
        for (const [lang, t] of Object.entries(s.texts)) {
          if (!/^[a-z]{2}$/.test(lang)) fail(`Invalid language '${lang}', ISO 639-1, e.g. sv`);
          const clean: NoticeTexts = {};
          for (const k of ['sender', 'review'] as const) {
            const v = t?.[k];
            if (v === undefined) continue;
            if (typeof v !== 'string' || !v.trim() || v.length > 2000) fail(`${market} ${lang} ${k} must be text of at most 2000 characters`);
            clean[k] = v.trim();
          }
          const unknown = Object.keys(t ?? {}).filter((k) => k !== 'sender' && k !== 'review');
          if (unknown.length) fail(`Unknown texts: ${unknown.join(', ')}`);
          out.texts[lang] = clean;
        }
      }
      markets[market] = out;
    }
    const next: NoticeSettings = { version: cur.version + 1, markets, changedBy: by, changedAt: this.d.clock.now(), reason };
    await this.d.settings.append(next).catch((e: unknown) => {
      if (e instanceof NoticeConflictError) throw new CommunicationsError('conflict', e.message);
      throw e;
    });
    return next;
  }

  async get(id: string): Promise<NoticeView> {
    const n = await this.d.store.get(id);
    if (!n) throw new CommunicationsError('not_found', `Notice ${id} does not exist`);
    return viewOf(n, this.d.clock.now());
  }

  /** Notices, oldest first. `overdue`/`late` keep only those flagged; `attention` keeps failed, overdue and incomplete unsent ones: the queue for a person. */
  async list(filter: NoticeFilter & { overdue?: boolean; late?: boolean; attention?: boolean } = {}): Promise<NoticeView[]> {
    const { overdue, late, attention, ...stored } = filter;
    if (attention && stored.status === 'sent') return [];
    const now = this.d.clock.now();
    const all = (await this.d.store.list(attention ? { ...stored } : stored)).map((n) => viewOf(n, now));
    return all.filter((n) => (!overdue || n.overdue) && (!late || n.late) && (!attention || n.status === 'failed' || n.overdue || (n.status === 'pending' && n.incomplete)));
  }

  /** The document system's report: sent, with channel, time, archive id and checksum, or failed with a reason. */
  async addDelivery(noticeId: string, input: DeliveryInput, by: string): Promise<NoticeView> {
    const n = await this.d.store.get(noticeId);
    if (!n) throw new CommunicationsError('not_found', `Notice ${noticeId} does not exist`);
    const now = this.d.clock.now();
    const fail = (m: string): never => {
      throw new CommunicationsError('validation', m);
    };
    let d: Delivery;
    if (input.outcome === 'sent') {
      if (!(DELIVERY_CHANNELS as readonly string[]).includes(input.channel ?? '')) fail(`channel must be one of ${DELIVERY_CHANNELS.join(', ')}`);
      const at = Date.parse(input.sentAt ?? '');
      if (Number.isNaN(at)) fail('sentAt must be a timestamp');
      if (at > Date.parse(now) + 5 * 60_000) fail('sentAt cannot be in the future');
      if (at < Date.parse(n.createdAt) - 5 * 60_000) fail('sentAt cannot be before the notice was made');
      const documentId = (input.documentId ?? '').trim();
      if (!documentId || documentId.length > 200) fail('documentId is required: the document in the archive, at most 200 characters');
      if (!/^[0-9a-fA-F]{64}$/.test(input.sha256 ?? '')) fail('sha256 must be the document\'s checksum, 64 hex digits');
      if (input.reason !== undefined) fail('reason is only for a failed delivery');
      d = {
        id: this.d.ids.next('ndl'),
        outcome: 'sent',
        channel: input.channel as DeliveryChannel,
        sentAt: new Date(at).toISOString(),
        documentId,
        sha256: input.sha256!.toLowerCase(),
        reportedBy: by,
        reportedAt: now,
      };
    } else if (input.outcome === 'failed') {
      const reason = (input.reason ?? '').trim();
      if (!reason || reason.length > 500) fail('reason is required for a failed delivery, at most 500 characters');
      if (input.channel !== undefined && !(DELIVERY_CHANNELS as readonly string[]).includes(input.channel)) fail(`channel must be one of ${DELIVERY_CHANNELS.join(', ')}`);
      if (input.sentAt !== undefined || input.documentId !== undefined || input.sha256 !== undefined) fail('A failed delivery has no sentAt, documentId or sha256');
      d = { id: this.d.ids.next('ndl'), outcome: 'failed', ...(input.channel ? { channel: input.channel as DeliveryChannel } : {}), reason, reportedBy: by, reportedAt: now };
    } else {
      return fail('outcome must be sent or failed');
    }
    await this.d.store.addDelivery(noticeId, d).catch((e: unknown) => {
      if (e instanceof NoticeConflictError) throw new CommunicationsError('conflict', e.message);
      throw e;
    });
    return this.get(noticeId);
  }
}

/** The policyholder on a date: the version that covers it, else the nearest one. */
function holderOn(p: PolicyView, date: ISODate): string {
  const v = p.versions.find((x) => x.validFrom <= date && date < x.validTo) ?? p.versions.filter((x) => x.validFrom <= date).at(-1) ?? p.versions[0];
  if (!v) throw new Error(`The policy ${p.id} has no versions`);
  return v.policyholderPartyId;
}

function termContent(t: TermView): Record<string, unknown> {
  return {
    termNo: t.termNo,
    productVersion: t.productVersion,
    startDate: t.startDate,
    endDate: t.endDate,
    premium: { amount: t.premium, currency: t.currency },
    vetCare: structuredClone(t.vetCare),
    deductibleOption: t.deductibleOption,
    riders: t.riders.map((r) => ({ description: r.description, diagnosisCodes: [...r.diagnosisCodes], validFrom: r.validFrom })),
  };
}

/** What changed at renewal: the product version, the premium, the vet care terms or the riders. */
function changesBetween(a: TermView, b: TermView): string[] {
  const same = (x: unknown, y: unknown) => JSON.stringify(sorted(x)) === JSON.stringify(sorted(y));
  const riders = (t: TermView) => t.riders.map((r) => ({ d: r.description, c: [...r.diagnosisCodes].sort() }));
  return [
    ...(a.productVersion !== b.productVersion ? ['product-version'] : []),
    ...(a.premium !== b.premium || a.currency !== b.currency ? ['premium'] : []),
    ...(!same(a.vetCare, b.vetCare) || a.deductibleOption !== b.deductibleOption ? ['vet-care'] : []),
    ...(!same(riders(a), riders(b)) ? ['riders'] : []),
  ];
}

function sorted(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sorted);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, sorted(x)]));
  return v;
}

/** In-memory store, for tests and the dev server without a database. */
export class InMemoryNoticeStore implements NoticeStore {
  private rows: Notice[] = [];

  async add(n: Notice) {
    if (this.rows.some((r) => r.source.eventId === n.source.eventId && r.type === n.type)) return false;
    this.rows.push(structuredClone({ ...n, deliveries: [] }));
    return true;
  }

  async get(id: string) {
    const r = this.rows.find((x) => x.id === id);
    return r ? structuredClone(r) : null;
  }

  async list(f: NoticeFilter) {
    return structuredClone(
      this.rows.filter((n) => {
        const status = n.deliveries.some((d) => d.outcome === 'sent') ? 'sent' : n.deliveries.length ? 'failed' : 'pending';
        return (
          (!f.status || status === f.status) &&
          (!f.type || n.type === f.type) &&
          (!f.market || n.market === f.market) &&
          (!f.policyId || n.policyId === f.policyId) &&
          (!f.applicationId || n.applicationId === f.applicationId) &&
          (!f.recipientPartyId || n.recipientPartyId === f.recipientPartyId)
        );
      }),
    );
  }

  async addDelivery(noticeId: string, d: Delivery) {
    const n = this.rows.find((x) => x.id === noticeId);
    if (!n) throw new NoticeConflictError(`Notice ${noticeId} does not exist`);
    n.deliveries.push(structuredClone(d));
  }
}

export class InMemoryNoticeSettingsStore implements NoticeSettingsStore {
  private list: NoticeSettings[] = [];

  async current() {
    return structuredClone(this.list.at(-1) ?? null);
  }

  async versions() {
    return structuredClone(this.list);
  }

  async append(s: NoticeSettings) {
    if (s.version !== (this.list.at(-1)?.version ?? 0) + 1) throw new NoticeConflictError(`Notice settings version ${s.version} is not the next`);
    this.list.push(structuredClone(s));
  }
}
