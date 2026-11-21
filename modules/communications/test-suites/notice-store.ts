/** The NoticeStore contract, run against every implementation. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { NoticeConflictError, type Delivery, type Notice, type NoticeSettings, type NoticeSettingsStore, type NoticeStore } from '../src/index.ts';

export function notice(n = 1, o: Partial<Notice> = {}): Notice {
  return {
    id: `ntc_${n}`,
    type: 'policy-confirmation',
    schema: 'policy-confirmation.v1',
    market: 'SE',
    recipientPartyId: 'pty_anna',
    language: 'sv',
    policyId: `pol_${n}`,
    source: { eventId: `pev_${n}`, eventType: 'policy.issued', occurredAt: '2026-11-16T10:00:00.000Z' },
    legalBasis: ['Insurance Contracts Act (2005:104) chapter 2 section 4'],
    dueBy: '2026-11-19',
    content: { policyId: `pol_${n}`, premium: { amount: 480_000, currency: 'SEK' } },
    settingsVersion: 1,
    documentMaker: 'insurer',
    createdAt: '2026-11-16T10:00:01.000Z',
    deliveries: [],
    ...o,
  };
}

export const sent = (n: number, o: Partial<Delivery> = {}): Delivery => ({
  id: `ndl_${n}`,
  outcome: 'sent',
  channel: 'digital-mailbox',
  sentAt: '2026-11-17T08:00:00.000Z',
  documentId: `doc-${n}`,
  sha256: 'a'.repeat(64),
  reportedBy: 'document-service',
  reportedAt: '2026-11-17T08:00:05.000Z',
  ...o,
});

export const failed = (n: number, o: Partial<Delivery> = {}): Delivery => ({
  id: `ndl_${n}`,
  outcome: 'failed',
  reason: 'No postal address',
  reportedBy: 'document-service',
  reportedAt: '2026-11-17T07:00:00.000Z',
  ...o,
});

export function noticeStoreSuite(name: string, make: () => Promise<{ store: NoticeStore }>) {
  describe(name, () => {
    test('a notice is stored once per event and type, and read back as it was', async () => {
      const { store } = await make();
      assert.equal(await store.add(notice(), []), true);
      assert.equal(await store.add(notice(2, { source: notice().source }), []), false, 'the same event and type again');
      assert.equal(await store.add(notice(3, { type: 'cancellation-confirmation', schema: 'cancellation-confirmation.v1', source: notice().source }), []), true);
      assert.deepEqual(await store.get('ntc_1'), notice());
      assert.equal(await store.get('ntc_2'), null);
      const app = notice(4, { policyId: undefined, applicationId: 'app_1', type: 'application-declined', schema: 'application-declined.v1' });
      delete (app as { policyId?: string }).policyId;
      await store.add(app, []);
      assert.deepEqual(await store.get('ntc_4'), app);
    });

    test('events are written with the notice or delivery, and published once', async () => {
      const { store } = await make();
      const ev = (id: string, type: 'notice.created' | 'notice.delivered', noticeId = 'ntc_1') => ({ id, type, noticeId, market: 'SE', occurredAt: '2026-11-16T10:00:01.000Z', data: { noticeType: 'policy-confirmation' } });
      await store.add(notice(), [ev('nev_1', 'notice.created')]);
      assert.equal(await store.add(notice(2, { source: notice().source }), [ev('nev_2', 'notice.created', 'ntc_2')]), false);
      await store.addDelivery('ntc_1', sent(1), [ev('nev_3', 'notice.delivered')]);
      assert.deepEqual((await store.pendingEvents(10)).map((e) => [e.id, e.type, e.noticeId]), [['nev_1', 'notice.created', 'ntc_1'], ['nev_3', 'notice.delivered', 'ntc_1']]);
      const [one, two] = await store.pendingEvents(10);
      const { sequence: first, ...created } = one!;
      const second = two!.sequence;
      assert.deepEqual(created, ev('nev_1', 'notice.created'));
      assert.ok(first! < second!, 'the outbox position increases');
      await store.markPublished(['nev_1'], '2026-11-16T10:00:02.000Z');
      assert.deepEqual((await store.pendingEvents(10)).map((e) => e.id), ['nev_3']);
    });

    test('deliveries are added in order and give the status the list filters on', async () => {
      const { store } = await make();
      for (const n of [1, 2, 3]) await store.add(notice(n), []);
      await store.addDelivery('ntc_2', failed(1), []);
      await store.addDelivery('ntc_3', failed(2), []);
      await store.addDelivery('ntc_3', sent(3), []);
      await assert.rejects(store.addDelivery('ntc_none', sent(4), []), NoticeConflictError);
      assert.deepEqual((await store.get('ntc_3'))!.deliveries, [failed(2), sent(3)]);
      const ids = async (f: Parameters<NoticeStore['list']>[0]) => (await store.list(f)).map((n) => n.id);
      assert.deepEqual(await ids({}), ['ntc_1', 'ntc_2', 'ntc_3']);
      assert.deepEqual(await ids({ status: 'pending' }), ['ntc_1']);
      assert.deepEqual(await ids({ status: 'failed' }), ['ntc_2']);
      assert.deepEqual(await ids({ status: 'sent' }), ['ntc_3']);
      assert.deepEqual(await ids({ policyId: 'pol_2' }), ['ntc_2']);
      assert.deepEqual(await ids({ recipientPartyId: 'pty_bo' }), []);
      assert.deepEqual(await ids({ type: 'policy-confirmation', market: 'SE' }), ['ntc_1', 'ntc_2', 'ntc_3']);
    });

    test("Petvold's PDF is stored once per notice, with its event (ADR 0038)", async () => {
      const { store } = await make();
      await store.add(notice(1, { documentMaker: 'petvold' }), []);
      const doc = { id: 'doc_abc', sha256: 'b'.repeat(64), madeBy: 'petvold', madeAt: '2026-11-16T10:00:03.000Z' };
      const ev = { id: 'nev_9', type: 'notice.document_made' as const, noticeId: 'ntc_1', market: 'SE', occurredAt: doc.madeAt, data: { documentId: 'doc_abc' } };
      await store.addDocument('ntc_1', doc, [ev]);
      await assert.rejects(store.addDocument('ntc_1', { ...doc, id: 'doc_other' }, []), NoticeConflictError);
      await assert.rejects(store.addDocument('ntc_none', doc, []), NoticeConflictError);
      assert.deepEqual(await store.get('ntc_1'), notice(1, { documentMaker: 'petvold', document: doc }));
      assert.deepEqual((await store.pendingEvents(10)).map((e) => e.type), ['notice.document_made']);
    });
  });
}

export function noticeSettingsStoreSuite(name: string, make: () => Promise<{ settings: NoticeSettingsStore }>) {
  describe(name, () => {
    test('settings are versions, appended only as the next one', async () => {
      const { settings } = await make();
      const v = (version: number): NoticeSettings => ({
        version,
        markets: { SE: { promptlyDays: 3 + version, texts: { sv: { review: `Review ${version}` } } } },
        changedBy: 'comms',
        changedAt: `2026-11-1${version}T10:00:00.000Z`,
        reason: `Version ${version}`,
      });
      assert.equal(await settings.current(), null);
      await assert.rejects(settings.append(v(2)), NoticeConflictError);
      await settings.append(v(1));
      await assert.rejects(settings.append(v(1)), NoticeConflictError);
      await settings.append(v(2));
      assert.deepEqual(await settings.current(), v(2));
      assert.deepEqual(await settings.versions(), [v(1), v(2)]);
    });
  });
}
