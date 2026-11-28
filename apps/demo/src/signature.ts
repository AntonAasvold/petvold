/**
 * Standard Webhooks (standardwebhooks.com, the specification on GitHub):
 * webhook-signature holds one or more 'v1,<base64>' separated by spaces, each
 * the HMAC-SHA256 of 'webhook-id.webhook-timestamp.body' with the secret's
 * bytes. While Petvold changes the secret it signs with both, and one match is
 * enough. Pure, except for node:crypto.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export type SignatureProblem = 'missing-headers' | 'bad-timestamp' | 'too-old' | 'too-new' | 'no-match';

export interface SignedHeaders {
  id: string | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
}

/** The secret's bytes: whsec_ and base64. */
export function secretBytes(secret: string): Buffer {
  return Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
}

/** The signature for one secret, as Petvold writes it. */
export function sign(secret: string, id: string, timestamp: number, body: string): string {
  return `v1,${createHmac('sha256', secretBytes(secret)).update(`${id}.${timestamp}.${body}`).digest('base64')}`;
}

/**
 * null when the call is signed with the secret and its timestamp is within
 * the tolerance of now (seconds); otherwise why not.
 */
export function verify(secret: string, h: SignedHeaders, body: string, nowSeconds: number, toleranceSeconds = 300): SignatureProblem | null {
  if (!h.id || !h.timestamp || !h.signature) return 'missing-headers';
  if (!/^\d{1,12}$/.test(h.timestamp)) return 'bad-timestamp';
  const ts = Number(h.timestamp);
  if (nowSeconds - ts > toleranceSeconds) return 'too-old';
  if (ts - nowSeconds > toleranceSeconds) return 'too-new';
  const expected = createHmac('sha256', secretBytes(secret)).update(`${h.id}.${h.timestamp}.${body}`).digest();
  const matches = h.signature.split(' ').some((part) => {
    const [version, value] = part.split(',', 2);
    if (version !== 'v1' || !value) return false;
    const given = Buffer.from(value, 'base64');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  return matches ? null : 'no-match';
}
