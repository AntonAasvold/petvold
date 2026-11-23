/**
 * The demo's test data (ADR 0041): customers, dogs, policies, claims, invoices
 * and payments over months, made through the API with a clock that moves day
 * by day. Every rule, event and decision is made as in a real installation, so
 * the data can be explained like any other (ADR 0018).
 *
 * Made up (ADR 0009): names come from lists of common first and last names,
 * streets are invented, and no one has a personal number. The same seed gives
 * the same data.
 */
import { signNotification, FAKE_NOTIFICATION_SCHEMA } from '@petvold/payments';
import { addDays } from '@petvold/common';
import type { Installation } from './composition.ts';
import { seedInstallation, seedSampleData } from './seed.ts';
import { createApp } from './app.ts';
import { demoAuthenticator } from './demo-tokens.ts';
import noticeTexts from '../seed/demo-notice-texts.json' with { type: 'json' };

export interface DemoOptions {
  /** The first day, e.g. six months before `to`. */
  from: string;
  /** The last day, usually today. */
  to: string;
  /** The random seed: the same seed gives the same data. */
  seed: number;
  /** New customers per day on average. */
  customersPerDay: number;
  /** The fake bank's secret (PETVOLD_FAKE_BANK_SECRET). */
  bankSecret: string;
  /** Petvold makes the notices' PDFs (documentMaker: petvold). Needs Gotenberg. */
  petvoldDocuments?: boolean;
  /**
   * The demo service's receiver (DEMO_WEBHOOK_URL). Subscribed to every event
   * before anything happens, so the demo service gets the whole history when
   * Petvold starts. The demo service rotates the secret when it starts: the
   * secret is in no log.
   */
  webhookUrl?: string;
  log?: (line: string) => void;
}

export interface DemoSummary {
  days: number;
  customers: number;
  dogs: number;
  policies: number;
  applications: number;
  claims: number;
  decisions: number;
  approvals: number;
  changes: number;
  cancellations: number;
  payments: number;
  payouts: number;
  writeOffs: number;
}

/** A mutable clock for the installation, set by the demo day by day. */
export class DemoClock {
  constructor(private at: string) {}
  now(): string {
    return this.at;
  }
  set(at: string): void {
    this.at = at;
  }
}

/** Mulberry32: small, fast and the same everywhere. */
export function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ids from the seed, so that the same seed gives the same ids. 32 hex digits, like the random ones. */
export function demoIds(seed: number): { next(prefix: string): string } {
  const rnd = random(seed ^ 0x5eed);
  const hex = () => Math.floor(rnd() * 0x100000000).toString(16).padStart(8, '0');
  return { next: (prefix) => `${prefix}_${hex()}${hex()}${hex()}${hex()}` };
}

const GIVEN = ['Anna', 'Erik', 'Maria', 'Lars', 'Karin', 'Johan', 'Sara', 'Anders', 'Emma', 'Per', 'Elin', 'Mikael', 'Linnea', 'Fredrik', 'Ida', 'Henrik', 'Maja', 'Oskar', 'Hanna', 'Gustav', 'Frida', 'Jonas', 'Klara', 'Nils', 'Alva', 'Viktor', 'Ebba', 'Axel', 'Wilma', 'Karl'];
const FAMILY = ['Andersson', 'Johansson', 'Karlsson', 'Nilsson', 'Eriksson', 'Larsson', 'Olsson', 'Persson', 'Svensson', 'Gustafsson', 'Pettersson', 'Jonsson', 'Lindberg', 'Lindqvist', 'Berg', 'Holm', 'Sandberg', 'Lund', 'Ek', 'Strand'];
const CITIES = [
  { city: 'Stockholm', postalCode: '11' },
  { city: 'Gothenburg', postalCode: '41' },
  { city: 'Malmo', postalCode: '21' },
  { city: 'Uppsala', postalCode: '75' },
  { city: 'Vasteras', postalCode: '72' },
  { city: 'Orebro', postalCode: '70' },
  { city: 'Linkoping', postalCode: '58' },
  { city: 'Umea', postalCode: '90' },
];
const STREETS = ['Birch Road', 'Oak Street', 'Lake Road', 'Mill Lane', 'Harbour Street', 'Meadow Way', 'Forest Road', 'Church Street'];
const DOGS = ['Bella', 'Molly', 'Charlie', 'Luna', 'Max', 'Ronja', 'Sixten', 'Selma', 'Leo', 'Wilma', 'Ludde', 'Saga', 'Rocky', 'Tindra', 'Zorro', 'Freja', 'Milo', 'Stella', 'Doris', 'Nala'];
const BREEDS = ['dog-mixed', 'dog-labrador-retriever', 'dog-german-shepherd', 'dog-golden-retriever'];

/** Claims a dog may have, with lines per category (SEK in minor units, before randomness). */
const CLAIMS = [
  {
    diagnosisCode: 'ORA-OTIT',
    weight: 5,
    lines: [
      { description: 'Examination', category: 'examination', amount: 65_000 },
      { description: 'Ear cytology', category: 'diagnostics', amount: 48_000 },
      { description: 'Ear drops', category: 'medication', amount: 29_000 },
    ],
  },
  {
    diagnosisCode: 'GI-ENTERIT',
    weight: 4,
    lines: [
      { description: 'Examination', category: 'examination', amount: 70_000 },
      { description: 'Blood tests', category: 'diagnostics', amount: 120_000 },
      { description: 'Medication', category: 'medication', amount: 45_000 },
      { description: 'Prescription food', category: 'food', amount: 38_000 },
    ],
  },
  {
    diagnosisCode: 'GI-ENTERIT',
    weight: 1,
    lines: [
      { description: 'Emergency examination', category: 'examination', amount: 120_000 },
      { description: 'Ultrasound, abdomen', category: 'diagnostics', amount: 310_000 },
      { description: 'Anaesthesia', category: 'anaesthesia', amount: 180_000 },
      { description: 'Laparotomy, removal of foreign body', category: 'surgery', amount: 2_600_000 },
      { description: 'Hospital care, 2 days', category: 'hospitalisation', amount: 540_000 },
    ],
  },
  {
    diagnosisCode: 'ORT-KORSBAND-V',
    weight: 2,
    lines: [
      { description: 'Examination, orthopaedics', category: 'examination', amount: 85_000 },
      { description: 'X-ray hind legs', category: 'diagnostics', amount: 290_000 },
      { description: 'Anaesthesia', category: 'anaesthesia', amount: 124_000 },
      { description: 'TPLO surgery', category: 'surgery', amount: 1_240_000 },
      { description: 'Pain relief', category: 'medication', amount: 83_000 },
    ],
  },
];

interface Dog {
  animalId: string;
  partyId: string;
  policyId?: string;
  /** The day it was issued, from which the 14 days of withdrawal count. */
  issuedOn?: string;
  startDate?: string;
  /** The products' deductibles are standard (the default) and high. */
  deductible?: 'standard' | 'high';
}

interface Bank {
  /** When each invoice will be paid, or null if never. Decided when first seen. */
  plan: Map<string, { on: string | null; amount: number; reference: string | null }>;
  paid: Set<string>;
  n: number;
}

/**
 * Runs the demo from `from` to `to`. The installation must be new: it is
 * given the installation's rules and products first, and the sample data
 * (Bella and the others) on the last day.
 */
export async function runDemo(inst: Installation, clock: DemoClock, o: DemoOptions): Promise<DemoSummary> {
  const rnd = random(o.seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const chance = (p: number) => rnd() < p;
  const between = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const log = o.log ?? (() => {});
  const sum: DemoSummary = { days: 0, customers: 0, dogs: 0, policies: 0, applications: 0, claims: 0, decisions: 0, approvals: 0, changes: 0, cancellations: 0, payments: 0, payouts: 0, writeOffs: 0 };

  const app = createApp({ ...inst.deps, auth: demoAuthenticator() });
  let key = 0;
  const call = async (method: string, path: string, token: string, body?: unknown): Promise<{ status: number; body: any }> => {
    const res = await app.request(path, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(method === 'GET' ? {} : { 'content-type': 'application/json', 'idempotency-key': `demo-${o.seed}-${++key}` }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: res.status, body: res.status === 204 ? null : await res.json() };
  };
  const must = async (method: string, path: string, token: string, body?: unknown) => {
    const r = await call(method, path, token, body);
    if (r.status >= 300) throw new Error(`${method} ${path} gave ${r.status}: ${JSON.stringify(r.body)}`);
    return r.body;
  };
  const all = async (path: string, token: string): Promise<any[]> => {
    const out: any[] = [];
    let cursor: string | undefined;
    do {
      const sep = path.includes('?') ? '&' : '?';
      const page = await must('GET', `${path}${sep}limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, token);
      out.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
    return out;
  };
  const drain = async () => {
    for (let i = 0; i < 1000 && (await inst.relay.tick()) > 0; i++);
  };

  // The installation starts with its rules and products, before any customer.
  clock.set(`${o.from}T06:00:00.000Z`);
  await seedInstallation(inst, clock);
  if (o.webhookUrl) {
    await must('POST', '/v1/webhook-subscriptions', 'dev-integration', { url: o.webhookUrl, eventTypes: ['*'], markets: '*', description: 'Petvold Demo' });
  }

  // The demo insurer's texts in notices, as an insurer sets them (ADR 0032).
  const settings = await must('GET', '/v1/settings/notices', 'dev-communications');
  await must('POST', '/v1/settings/notices/versions', 'dev-communications', {
    basedOnVersion: settings.version,
    reason: 'The demo insurer\'s texts',
    markets: { SE: { texts: noticeTexts, ...(o.petvoldDocuments ? { documentMaker: 'petvold' } : {}) } },
  });
  // The demo clinic (dev-clinic) has an agreement on direct settlement: its claims are paid to it (ADR 0040, punkt 8).
  await must('POST', '/v1/clinic-agreements', 'dev-billing', { clinicId: 'clinic_001', market: 'SE', validFrom: o.from });
  await must('POST', '/v1/clinics/clinic_001/accounts', 'dev-billing', { market: 'SE', method: 'se-bank', details: { clearing: '5000', account: '1234567890' } });
  const shown = (
    ((await must('GET', '/v1/products/SE-HUND-PLUS/versions/2026.1', 'dev-all')).content?.documents ?? []) as { type: string; language: string; sha256: string }[]
  )
    .filter((x) => x.language === 'sv' && x.type !== 'ipid')
    .map((x) => ({ type: x.type, language: x.language, sha256: x.sha256 }));

  const dogs: Dog[] = [];
  const bank: Bank = { plan: new Map(), paid: new Set(), n: 0 };
  const pendingDecisions = new Map<string, { on: string; proposed: 'approved' | 'rejected' }>(); // claimId -> the day a handler looks at it
  const pendingApprovals = new Map<string, string>();
  const bankAccount = () => ({ market: 'SE', method: 'se-bank', details: { clearing: String(between(8000, 8999)), account: String(between(100_000_000, 999_999_999)) } });
  const detailsDue = new Map<string, string>(); // partyId -> the day the customer gives an account
  const releaseDue = new Map<string, string>(); // payoutId -> the day finance releases it
  const referred = new Map<string, string>(); // applicationId -> the day an underwriter looks at it

  for (let day = o.from; day <= o.to; day = addDays(day, 1)) {
    sum.days++;
    let minute = 0;
    const at = (hour: number) => {
      // Each action a minute after the last, in the working day (UTC).
      clock.set(`${day}T${String(hour + Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00.000Z`);
      minute++;
    };

    // The night's runs: renewal, invoicing, reminders and retention (ADR 0037).
    clock.set(`${day}T04:30:00.000Z`);
    await inst.scheduler.tick();
    await drain();

    // New customers with one to three dogs.
    let newCustomers = 0;
    for (let x = o.customersPerDay; x > 0; x--) if (chance(Math.min(1, x))) newCustomers++;
    for (let c = 0; c < newCustomers; c++) {
      at(8);
      const given = pick(GIVEN);
      const family = pick(FAMILY);
      const place = pick(CITIES);
      const party = await must('POST', '/v1/parties', 'dev-all', {
        kind: 'person',
        market: 'SE',
        givenName: given,
        familyName: family,
        email: `${given}.${family}.${sum.customers + 1}@example.test`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''),
        address: { street: `${pick(STREETS)} ${between(1, 80)}`, postalCode: `${place.postalCode}${between(100, 999)}`, city: place.city, country: 'SE' },
        language: 'sv',
      });
      sum.customers++;
      // Most give the account their claims are paid to when they sign up (ADR 0040, punkt 8).
      if (chance(0.8)) await must('POST', `/v1/payees/${party.id}/accounts`, 'dev-all', bankAccount());
      const count = chance(0.7) ? 1 : chance(0.7) ? 2 : 3;
      const household: Dog[] = [];
      for (let d = 0; d < count; d++) {
        at(8);
        const birth = addDays(day, -between(120, 365 * 9));
        const animal = await must('POST', '/v1/animals', 'dev-all', {
          market: 'SE',
          species: 'dog',
          breed: pick(BREEDS),
          sex: chance(0.5) ? 'male' : 'female',
          neutered: chance(0.4),
          name: pick(DOGS),
          birthDate: birth,
          allowLookup: true,
          identifiers: [{ type: 'microchip', value: `752098${String(o.seed % 1000).padStart(3, '0')}${String(dogs.length + household.length + 1).padStart(6, '0')}` }],
          owner: { partyId: party.id, from: birth > addDays(day, -60) ? birth : addDays(birth, 60) },
        });
        household.push({ animalId: animal.id, partyId: party.id });
        sum.dogs++;
      }
      const group = household.length > 1 && chance(0.6) ? await must('POST', '/v1/policy-groups', 'dev-all', { market: 'SE', kind: 'household', holderPartyId: party.id }) : null;
      for (const dog of household) {
        at(9);
        const startDate = addDays(day, between(0, 10));
        const acceptance = { channel: pick(['web', 'app', 'phone']), reference: `demo-${dog.animalId}`, acceptedAt: clock.now() };
        const paymentInterval = pick(['year', 'quarter', 'month', 'month', 'month']);
        if (chance(0.8)) {
          const r = await call('POST', '/v1/policies', 'dev-all', {
            market: 'SE',
            animalId: dog.animalId,
            policyholderPartyId: dog.partyId,
            productVersion: 'SE-HUND-BAS@2026.1',
            startDate,
            acceptance,
            paymentInterval,
            ...(group ? { groupId: group.id } : {}),
          });
          if (r.status < 300) {
            dog.policyId = r.body.id;
            dog.issuedOn = day;
            dog.startDate = startDate;
            dog.deductible = 'standard';
            sum.policies++;
          }
        } else {
          const sick = chance(0.3);
          const r = await call('POST', '/v1/applications', 'dev-all', {
            market: 'SE',
            animalId: dog.animalId,
            policyholderPartyId: dog.partyId,
            productVersion: 'SE-HUND-PLUS@2026.1',
            startDate,
            acceptance: { ...acceptance, documents: shown },
            paymentInterval,
            answers: [
              { question: 'previous-illness', value: sick, ...(sick ? { diagnosisCodes: ['ORA-OTIT'] } : {}) },
              { question: 'ongoing-symptoms', value: chance(0.15) },
              { question: 'lameness', value: false },
            ],
          });
          if (r.status < 300) {
            sum.applications++;
            const a = r.body;
            if (a.policyId) {
              dog.policyId = a.policyId;
              dog.issuedOn = day;
              dog.startDate = startDate;
              dog.deductible = 'standard';
              sum.policies++;
            } else if (a.status === 'referred') {
              referred.set(a.id, addDays(day, between(1, 4)));
            }
          }
        }
        dogs.push(dog);
      }
    }

    // An underwriter decides the referred applications.
    for (const [id, on] of referred) {
      if (on > day) continue;
      at(10);
      const accept = chance(0.7);
      const r = await call('POST', `/v1/applications/${id}/decisions`, 'dev-underwriter', accept ? { outcome: 'accept', note: 'The vet record shows no ongoing illness.' } : { outcome: 'decline', note: 'Symptoms not yet examined by a vet.', reason: 'ongoing-symptoms' });
      referred.delete(id);
      if (r.status < 300 && accept) {
        const policyId = r.body.policyId;
        const dog = dogs.find((d) => d.animalId === r.body.animalId);
        if (dog && policyId) {
          dog.policyId = policyId;
          dog.issuedOn = day;
          dog.startDate = r.body.startDate ?? day;
          dog.deductible = 'standard';
          sum.policies++;
        }
      }
    }

    // Claims: about one a year per dog, after the waiting period.
    for (const dog of dogs) {
      if (!dog.policyId || !dog.startDate || addDays(dog.startDate, 35) > day || !chance(1 / 120)) continue;
      at(11);
      const t = weighted(CLAIMS, rnd);
      const scale = 0.7 + rnd() * 0.8;
      const clinic = chance(0.6);
      const treatmentTo = addDays(day, -between(0, 6));
      const r = await call('POST', '/v1/claims', clinic ? 'dev-clinic' : 'dev-all', {
        policyId: dog.policyId,
        animalId: dog.animalId,
        market: 'SE',
        currency: 'SEK',
        channel: clinic ? 'clinic_direct' : 'customer',
        treatmentFrom: treatmentTo,
        treatmentTo,
        diagnosisCode: t.diagnosisCode,
        lines: t.lines.map((l, i) => ({ id: `l${i + 1}`, ...l, amount: Math.round((l.amount * scale) / 100) * 100 })),
      });
      if (r.status >= 300) continue;
      sum.claims++;
      // No decision: the rules left it to a person, with their proposal.
      if (!r.body.decision) pendingDecisions.set(r.body.claim.id, { on: addDays(day, between(1, 5)), proposed: r.body.assessment.proposedOutcome });
    }

    // A handler decides; above the handler's limit, an approver approves.
    for (const [id, { on, proposed }] of pendingDecisions) {
      if (on > day) continue;
      at(12);
      pendingDecisions.delete(id);
      // The handler mostly follows the proposal, e.g. a rejection below the deductible. Now and then not, with a reason.
      const follow = chance(0.9);
      const body =
        proposed === 'rejected'
          ? { action: 'reject', reason: 'The costs are below the deductible.' }
          : follow
            ? { action: 'accept', reason: 'Treatment covered by the policy.' }
            : { action: 'reject', reason: 'The journal shows the condition started before the policy.', reasonCode: 'pre_existing_condition' };
      const r = await call('POST', `/v1/claims/${id}/decisions`, 'dev-handler', body);
      if (r.status >= 300) throw new Error(`The decision on ${id} gave ${r.status}: ${JSON.stringify(r.body)}`);
      sum.decisions++;
      // 202: above the handler's limit, a proposal for an approver.
      if (r.status === 202) pendingApprovals.set(`${id}/${r.body.id}`, addDays(day, between(1, 3)));
    }
    for (const [key, on] of pendingApprovals) {
      if (on > day) continue;
      at(13);
      pendingApprovals.delete(key);
      const [claimId, proposalId] = key.split('/');
      const r = await call('POST', `/v1/claims/${claimId}/proposals/${proposalId}/approvals`, 'dev-approver', {});
      if (r.status < 300) sum.approvals++;
    }

    // Now and then a customer changes the deductible, regrets or the need ceases.
    for (const dog of dogs) {
      if (!dog.policyId || !dog.startDate || dog.startDate > day) continue;
      if (chance(1 / 900)) {
        at(14);
        const deductible = dog.deductible === 'high' ? 'standard' : 'high';
        const r = await call('POST', `/v1/policies/${dog.policyId}/changes`, 'dev-all', { from: addDays(day, 1), vetCare: { deductible }, reason: 'The customer chose another deductible.' });
        if (r.status === 409) {
          // Cancelled meanwhile, e.g. for unpaid premium: nothing more to do for it.
          dog.policyId = undefined;
          continue;
        }
        if (r.status >= 300) throw new Error(`The change of ${dog.policyId} gave ${r.status}: ${JSON.stringify(r.body)}`);
        dog.deductible = deductible;
        sum.changes++;
      } else if (chance(1 / 1500)) {
        at(14);
        const withdrawal = !!dog.issuedOn && addDays(dog.issuedOn, 13) >= day;
        const r = await call(
          'POST',
          `/v1/policies/${dog.policyId}/cancellations`,
          'dev-all',
          withdrawal ? { reason: 'withdrawal', receivedOn: day } : { reason: 'need-ceased', receivedOn: day, effectiveDate: day, note: 'The dog has died.' },
        );
        if (r.status < 300) sum.cancellations++;
        // Done, or cancelled already, e.g. for unpaid premium.
        if (r.status < 300 || r.status === 409) dog.policyId = undefined;
      }
    }

    await drain();

    // Payouts: a customer without an account gives one, and finance releases what new details held.
    at(14);
    for (const p of await all('/v1/payouts?status=awaiting-details', 'dev-billing')) if (!detailsDue.has(p.partyId)) detailsDue.set(p.partyId, addDays(day, between(1, 4)));
    for (const [partyId, on] of detailsDue) {
      if (on > day) continue;
      detailsDue.delete(partyId);
      await must('POST', `/v1/payees/${partyId}/accounts`, 'dev-all', bankAccount());
    }
    for (const p of await all('/v1/payouts?status=held', 'dev-billing')) if (!releaseDue.has(p.id)) releaseDue.set(p.id, addDays(day, between(1, 2)));
    for (const [id, on] of releaseDue) {
      if (on > day) continue;
      releaseDue.delete(id);
      const r = await call('POST', `/v1/payouts/${id}/releases`, 'dev-billing', { note: 'Called the customer on the number in the register.' });
      if (r.status >= 300 && r.status !== 409) throw new Error(`The release of ${id} gave ${r.status}: ${JSON.stringify(r.body)}`);
    }
    sum.payouts = (await all('/v1/payouts?status=paid', 'dev-billing')).length;
    await drain();

    // The bank: customers pay their invoices, most on time, some late and a few never. Late ones get a
    // reminder, and after three weeks notice of cancellation, which paying within it reverses (ADR 0040, punkt 7).
    at(15);
    for (const inv of await all('/v1/invoices?market=SE', 'dev-all')) {
      if (!bank.plan.has(inv.id)) {
        const r = rnd();
        const on = r < 0.85 ? addDays(inv.issueDate, between(2, Math.max(2, daysBetween(inv.issueDate, inv.dueDate)))) : r < 0.95 ? addDays(inv.dueDate, between(3, 30)) : null;
        // A few forget the OCR number: they wait among the unmatched payments for a person.
        bank.plan.set(inv.id, { on, amount: inv.total, reference: rnd() < 0.03 ? null : inv.reference.value });
      }
    }
    // Invoices never paid: when the cancellation has taken effect, finance writes off what is left.
    // Above the clerk's limit it is a proposal the head of finance approves (ADR 0040, punkt 10).
    for (const [id, p] of bank.plan) {
      if (p.on !== null || bank.paid.has(id)) continue;
      const inv = await must('GET', `/v1/invoices/${id}`, 'dev-billing');
      const noticed = inv.dunning.find((x: any) => x.step === 'cancellation-noticed');
      if (!noticed || inv.open <= 0 || addDays(noticed.on, 20) !== day) continue;
      const r = await must('POST', `/v1/invoices/${id}/credit-notes`, 'dev-billing', { kind: 'write-off', amount: inv.open, reason: 'Unpaid after the cancellation; not worth collecting.' });
      if (r.status === 'proposed') await must('POST', `/v1/credit-proposals/${r.id}/approvals`, 'dev-billing-manager', {});
      bank.paid.add(id);
      sum.writeOffs++;
    }
    const today = [...bank.plan.entries()].filter(([id, p]) => p.on === day && !bank.paid.has(id) && p.amount > 0);
    if (today.length > 0) {
      const body = JSON.stringify({
        schema: FAKE_NOTIFICATION_SCHEMA,
        payments: today.map(([id, p]) => ({ id: `demo-${o.seed}-${++bank.n}`, market: 'SE', currency: 'SEK', amount: p.amount, reference: p.reference, bookedOn: day, invoice: id })).map(({ invoice: _, ...p }) => p),
      });
      const raw = signNotification(o.bankSecret, `demo-bank-${day}`, Math.floor(Date.parse(clock.now()) / 1000), body);
      const res = await app.request('/provider-notifications/fake', { method: 'POST', headers: { 'content-type': 'application/json', ...(raw.headers as Record<string, string>) }, body: raw.body });
      if (res.status !== 200) throw new Error(`The fake bank was refused: ${res.status} ${await res.text()}`);
      for (const [id] of today) bank.paid.add(id);
      sum.payments += today.length;
    }
    await drain();
    if (day.endsWith('-01') || day === o.to) log(`${day}: ${sum.customers} customers, ${sum.policies} policies, ${sum.claims} claims, ${sum.payments} payments`);
  }

  // Bella and the others, for the tokens and the guides that name them.
  clock.set(`${o.to}T16:00:00.000Z`);
  await seedSampleData(inst, clock);
  await drain();
  return sum;
}

function weighted<T extends { weight: number }>(xs: readonly T[], rnd: () => number): T {
  let r = rnd() * xs.reduce((s, x) => s + x.weight, 0);
  for (const x of xs) if ((r -= x.weight) < 0) return x;
  return xs[xs.length - 1]!;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}
