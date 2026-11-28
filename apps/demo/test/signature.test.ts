import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sign, verify } from '../src/signature.ts';

// The example in the Standard Webhooks specification.
const secret = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';
const id = 'msg_p5jXN8AQM9LWM0D4loKWxJek';
const ts = 1614265330;
const body = '{"test": 2432232314}';
const expected = 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=';

test('signs as the Standard Webhooks example', () => {
  assert.equal(sign(secret, id, ts, body), expected);
});

test('accepts the example, and one match among several signatures', () => {
  assert.equal(verify(secret, { id, timestamp: String(ts), signature: expected }, body, ts), null);
  const other = sign('whsec_' + Buffer.alloc(32, 7).toString('base64'), id, ts, body);
  assert.equal(verify(secret, { id, timestamp: String(ts), signature: `${other} ${expected}` }, body, ts), null);
});

test('rejects a changed body, a wrong secret and unknown versions', () => {
  assert.equal(verify(secret, { id, timestamp: String(ts), signature: expected }, body + ' ', ts), 'no-match');
  assert.equal(verify('whsec_' + Buffer.alloc(32, 1).toString('base64'), { id, timestamp: String(ts), signature: expected }, body, ts), 'no-match');
  assert.equal(verify(secret, { id, timestamp: String(ts), signature: expected.replace('v1,', 'v2,') }, body, ts), 'no-match');
  assert.equal(verify(secret, { id, timestamp: String(ts), signature: 'v1,' }, body, ts), 'no-match');
});

test('rejects a timestamp more than five minutes off, and missing headers', () => {
  assert.equal(verify(secret, { id, timestamp: String(ts), signature: expected }, body, ts + 301), 'too-old');
  assert.equal(verify(secret, { id, timestamp: String(ts), signature: expected }, body, ts - 301), 'too-new');
  assert.equal(verify(secret, { id, timestamp: String(ts), signature: expected }, body, ts + 300), null);
  assert.equal(verify(secret, { id, timestamp: 'soon', signature: expected }, body, ts), 'bad-timestamp');
  assert.equal(verify(secret, { id: undefined, timestamp: String(ts), signature: expected }, body, ts), 'missing-headers');
});
