import { sign } from '../src/signature.ts';
import type { CloudEvent } from '../src/cloud-event.ts';

export const SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';

export function event(over: Partial<CloudEvent> = {}): CloudEvent {
  return {
    specversion: '1.0',
    id: 'evt_1',
    source: '/petvold/policies',
    type: 'petvold.policy.issued.v1',
    subject: 'pol_1',
    time: '2026-11-28T10:00:00.000Z',
    datacontenttype: 'application/json',
    market: 'SE',
    sequence: '00000000000000000001',
    data: { policyId: 'pol_1', startDate: '2026-12-01', premium: { amount: 412000, currency: 'SEK' } },
    ...over,
  };
}

/** A call as Petvold makes it. */
export function signed(body: string, o: { id?: string; at?: number; secret?: string } = {}): RequestInit {
  const id = o.id ?? 'evt_1';
  const at = o.at ?? Math.floor(Date.parse('2026-11-28T10:00:05Z') / 1000);
  return {
    method: 'POST',
    headers: { 'content-type': 'application/cloudevents+json', 'webhook-id': id, 'webhook-timestamp': String(at), 'webhook-signature': sign(o.secret ?? SECRET, id, at, body) },
    body,
  };
}
