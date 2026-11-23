/**
 * PaymentsStore against the schema `payments` (migration 0054). Connect with
 * the service role `payments_service`: it may only insert and read, so a
 * payment never changes.
 */
import type pg from 'pg';
import { PayoutConflictError, type ClinicAgreement, type Payee, type PayeeAccount, type PayoutFilter, type Payment, type PaymentEvent, type PaymentFilter, type PaymentsStore, type Payout, type PayoutStatus, type PayoutStep, type PayoutView } from './index.ts';

const UNIQUE_VIOLATION = '23505';

const iso = (t: unknown) => (t instanceof Date ? t.toISOString() : new Date(String(t)).toISOString());

const PAYMENT = `payment_id, direction, status, provider, provider_ref, market, currency, amount, reference, booked_on::text as booked_on, received_at`;

function payment(r: Record<string, any>): Payment {
  return {
    id: r.payment_id,
    direction: r.direction,
    status: r.status,
    provider: r.provider,
    providerRef: r.provider_ref,
    market: r.market,
    currency: r.currency,
    amount: Number(r.amount),
    reference: r.reference ?? null,
    bookedOn: String(r.booked_on),
    receivedAt: iso(r.received_at),
  };
}

export class PostgresPaymentsStore implements PaymentsStore {
  constructor(private readonly pool: pg.Pool) {}

  async addPayment(p: Payment, e: PaymentEvent): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query(
        `insert into payments.payment (payment_id, direction, status, provider, provider_ref, market, currency, amount, reference, booked_on, received_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [p.id, p.direction, p.status, p.provider, p.providerRef, p.market, p.currency, p.amount, p.reference, p.bookedOn, p.receivedAt],
      );
      await insertEvents(client, [e]);
      await client.query('commit');
      return true;
    } catch (err) {
      await client.query('rollback');
      if ((err as { code?: string }).code === UNIQUE_VIOLATION && (err as { constraint?: string }).constraint === 'payment_provider_provider_ref_key') return false;
      throw err;
    } finally {
      client.release();
    }
  }

  async payment(id: string): Promise<Payment | null> {
    const { rows } = await this.pool.query(`select ${PAYMENT} from payments.payment where payment_id = $1`, [id]);
    return rows[0] ? payment(rows[0]) : null;
  }

  async byProviderRef(provider: string, providerRef: string): Promise<Payment | null> {
    const { rows } = await this.pool.query(`select ${PAYMENT} from payments.payment where provider = $1 and provider_ref = $2`, [provider, providerRef]);
    return rows[0] ? payment(rows[0]) : null;
  }

  async payments(filter: PaymentFilter): Promise<Payment[]> {
    const { rows } = await this.pool.query(
      `select ${PAYMENT} from payments.payment
       where ($1::text is null or market = $1) and ($2::text is null or reference = $2)
       order by received_at, payment_id collate "C"`,
      [filter.market ?? null, filter.reference ?? null],
    );
    return rows.map(payment);
  }

  async pendingEvents(limit: number): Promise<PaymentEvent[]> {
    const { rows } = await this.pool.query(
      `select seq, event_id, type, payment_id, payout_id, market, occurred_at, data from payments.outbox where published_at is null order by seq limit $1`,
      [limit],
    );
    return rows.map((r) => ({
      id: r.event_id,
      type: r.type,
      ...(r.payment_id ? { paymentId: r.payment_id } : {}),
      ...(r.payout_id ? { payoutId: r.payout_id } : {}),
      market: r.market,
      occurredAt: iso(r.occurred_at),
      data: r.data,
      sequence: Number(r.seq),
    }));
  }

  async markPublished(ids: string[], at: string): Promise<void> {
    await this.pool.query(`update payments.outbox set published_at = $2 where event_id = any($1) and published_at is null`, [ids, at]);
  }

  async addPayeeAccount(a: PayeeAccount): Promise<void> {
    await this.pool.query(
      `insert into payments.payee_account (payee_account_id, party_id, clinic_id, market, method, details, created_at, created_by) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [a.id, a.partyId ?? null, a.clinicId ?? null, a.market, a.method, a.details, a.createdAt, a.createdBy],
    );
  }

  async payeeAccounts(payee: Payee): Promise<PayeeAccount[]> {
    const { rows } = await this.pool.query(
      `select ${ACCOUNT} from payments.payee_account where ${payee.clinicId ? 'clinic_id' : 'party_id'} = $1 order by created_at, payee_account_id collate "C"`,
      [payee.clinicId ?? payee.partyId],
    );
    return rows.map(account);
  }

  async addAgreement(a: ClinicAgreement): Promise<void> {
    await this.pool.query(
      `insert into payments.clinic_agreement (agreement_id, clinic_id, market, valid_from, valid_to, created_by, created_at) values ($1, $2, $3, $4, $5, $6, $7)`,
      [a.id, a.clinicId, a.market, a.validFrom, a.validTo ?? null, a.createdBy, a.createdAt],
    );
  }

  async endAgreement(id: string, e: NonNullable<ClinicAgreement['ended']>): Promise<void> {
    try {
      await this.pool.query(`insert into payments.clinic_agreement_ending (agreement_id, valid_to, ended_by, ended_at, reason) values ($1, $2, $3, $4, $5)`, [id, e.validTo, e.by, e.at, e.reason]);
    } catch (err) {
      if ((err as { code?: string }).code === UNIQUE_VIOLATION) throw new PayoutConflictError(`Agreement ${id} is ended already`);
      throw err;
    }
  }

  async agreement(id: string): Promise<ClinicAgreement | null> {
    return (await this.agreementRows(`a.agreement_id = $1`, [id]))[0] ?? null;
  }

  async agreements(filter: { clinicId?: string; market?: string }): Promise<ClinicAgreement[]> {
    return this.agreementRows(`($1::text is null or a.clinic_id = $1) and ($2::text is null or a.market = $2)`, [filter.clinicId ?? null, filter.market ?? null]);
  }

  private async agreementRows(where: string, params: unknown[]): Promise<ClinicAgreement[]> {
    const { rows } = await this.pool.query(
      `select a.agreement_id, a.clinic_id, a.market, a.valid_from::text as valid_from, a.valid_to::text as valid_to, a.created_by, a.created_at,
              e.valid_to::text as ended_to, e.ended_by, e.ended_at, e.reason
       from payments.clinic_agreement a left join payments.clinic_agreement_ending e using (agreement_id)
       where ${where} order by a.created_at, a.agreement_id collate "C"`,
      params,
    );
    return rows.map((r) => ({
      id: r.agreement_id,
      clinicId: r.clinic_id,
      market: r.market,
      validFrom: r.valid_from,
      ...(r.valid_to ? { validTo: r.valid_to } : {}),
      createdBy: r.created_by,
      createdAt: iso(r.created_at),
      ...(r.ended_to ? { ended: { validTo: r.ended_to, by: r.ended_by, at: iso(r.ended_at), reason: r.reason } } : {}),
    }));
  }

  async payeeAccount(id: string): Promise<PayeeAccount | null> {
    const { rows } = await this.pool.query(`select ${ACCOUNT} from payments.payee_account where payee_account_id = $1`, [id]);
    return rows[0] ? account(rows[0]) : null;
  }

  async addPayout(p: Payout, step: PayoutStep, events: PaymentEvent[]): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const ins = await client.query(
        `insert into payments.payout (payout_id, order_id, claim_id, decision_id, policy_id, market, currency, amount, party_id, clinic_id, provider, source_event_id, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) on conflict (order_id) do nothing`,
        [p.id, p.orderId, p.claimId, p.decisionId, p.policyId, p.market, p.currency, p.amount, p.partyId ?? null, p.clinicId ?? null, p.provider, p.sourceEventId, p.createdAt],
      );
      if (ins.rowCount === 0) {
        await client.query('rollback');
        return false;
      }
      await insertStep(client, p.id, 1, step);
      await insertEvents(client, events);
      await client.query('commit');
      return true;
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  }

  async addPayoutStep(payoutId: string, seq: number, step: PayoutStep, events: PaymentEvent[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      // The previous step must be there: a step is never added past a gap.
      const prev = await client.query(`select count(*)::int as n from payments.payout_step where payout_id = $1`, [payoutId]);
      if (prev.rows[0].n !== seq - 1) throw new PayoutConflictError(`Step ${seq} of payout ${payoutId} is taken`);
      await insertStep(client, payoutId, seq, step);
      await insertEvents(client, events);
      await client.query('commit');
    } catch (err) {
      await client.query('rollback');
      if ((err as { code?: string }).code === UNIQUE_VIOLATION && (err as { constraint?: string }).constraint === 'payout_step_pkey') {
        throw new PayoutConflictError(`Step ${seq} of payout ${payoutId} is taken`);
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async payout(id: string): Promise<PayoutView | null> {
    return (await this.payoutRows(`p.payout_id = $1`, [id]))[0] ?? null;
  }

  async payouts(filter: PayoutFilter): Promise<PayoutView[]> {
    const rows = await this.payoutRows(
      `($1::text is null or p.claim_id = $1) and ($2::text is null or p.party_id = $2) and ($3::text is null or p.market = $3) and ($4::text is null or p.clinic_id = $4)`,
      [filter.claimId ?? null, filter.partyId ?? null, filter.market ?? null, filter.clinicId ?? null],
    );
    return filter.status ? rows.filter((p) => p.status === filter.status) : rows;
  }

  private async payoutRows(where: string, params: unknown[]): Promise<PayoutView[]> {
    const { rows } = await this.pool.query(
      `select p.payout_id, p.order_id, p.claim_id, p.decision_id, p.policy_id, p.market, p.currency, p.amount, p.party_id, p.clinic_id, p.provider, p.source_event_id, p.created_at,
              (select json_agg(json_build_object('status', s.status, 'at', s.at, 'by', s.by_whom, 'payeeAccountId', s.payee_account_id, 'providerRef', s.provider_ref, 'note', s.note) order by s.seq)
               from payments.payout_step s where s.payout_id = p.payout_id) as steps
       from payments.payout p where ${where}
       order by p.created_at, p.payout_id collate "C"`,
      params,
    );
    return rows.map((r) => {
      const steps: PayoutStep[] = (r.steps ?? []).map((x: Record<string, any>) => ({
        status: x.status,
        at: iso(x.at),
        by: x.by,
        ...(x.payeeAccountId ? { payeeAccountId: x.payeeAccountId } : {}),
        ...(x.providerRef ? { providerRef: x.providerRef } : {}),
        ...(x.note ? { note: x.note } : {}),
      }));
      return {
        id: r.payout_id,
        orderId: r.order_id,
        claimId: r.claim_id,
        decisionId: r.decision_id,
        policyId: r.policy_id,
        market: r.market,
        currency: r.currency,
        amount: Number(r.amount),
        ...(r.clinic_id ? { clinicId: r.clinic_id as string } : { partyId: r.party_id as string }),
        provider: r.provider,
        sourceEventId: r.source_event_id,
        createdAt: iso(r.created_at),
        status: steps.at(-1)!.status,
        steps,
      };
    });
  }
}

const ACCOUNT = `payee_account_id, party_id, clinic_id, market, method, details, created_at, created_by`;

function account(r: Record<string, any>): PayeeAccount {
  return { id: r.payee_account_id, ...(r.clinic_id ? { clinicId: r.clinic_id as string } : { partyId: r.party_id as string }), market: r.market, method: r.method, details: r.details, createdAt: iso(r.created_at), createdBy: r.created_by };
}

async function insertStep(client: pg.PoolClient, payoutId: string, seq: number, s: PayoutStep) {
  await client.query(
    `insert into payments.payout_step (payout_id, seq, status, at, by_whom, payee_account_id, provider_ref, note) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [payoutId, seq, s.status, s.at, s.by, s.payeeAccountId ?? null, s.providerRef ?? null, s.note ?? null],
  );
}

async function insertEvents(client: pg.PoolClient, events: PaymentEvent[]) {
  for (const e of events) {
    await client.query(`insert into payments.outbox (event_id, type, payment_id, payout_id, market, occurred_at, data) values ($1, $2, $3, $4, $5, $6, $7)`, [
      e.id,
      e.type,
      e.paymentId ?? null,
      e.payoutId ?? null,
      e.market,
      e.occurredAt,
      e.data,
    ]);
  }
}
