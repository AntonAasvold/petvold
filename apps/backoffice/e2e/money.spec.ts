import { createHmac } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';

const API = 'http://127.0.0.1:8797';
// The dev server's fake bank secret (docs/funktion/premier.md). For development only.
const SECRET = 'whsec_cGV0dm9sZC1kZXYtZmFrZS1iYW5rcGV0dm9sZC1kZXY=';

/** A payment without a reference from the fake bank, signed like a webhook. */
async function unmatchedPayment(request: APIRequestContext, amount: number) {
  const id = `fb_e2e_${Date.now()}`;
  const body = JSON.stringify({ schema: 'petvold-fake-bank.v1', payments: [{ id, market: 'SE', currency: 'SEK', amount, reference: null, bookedOn: new Date().toISOString().slice(0, 10) }] });
  const ts = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', Buffer.from(SECRET.slice('whsec_'.length), 'base64')).update(`${id}.${ts}.${body}`).digest('base64');
  const res = await request.post(`${API}/provider-notifications/fake`, {
    headers: { 'content-type': 'application/json', 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': `v1,${signature}` },
    data: body,
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  // The relay takes the payment to billing within a second or so.
  await expect(async () => {
    const list = await request.get(`${API}/v1/received-payments?status=unmatched`, { headers: { authorization: 'Bearer dev-all' } });
    expect(((await list.json()) as { items: { amount: number }[] }).items.some((p) => p.amount === amount)).toBe(true);
  }).toPass({ timeout: 15_000 });
}

async function payerAccount(request: APIRequestContext): Promise<string> {
  // The relay makes the sample policy's payer account shortly after the server starts.
  let id = '';
  await expect(async () => {
    const res = await request.get(`${API}/v1/payer-accounts?market=SE`, { headers: { authorization: 'Bearer dev-all' } });
    id = ((await res.json()) as { items: { id: string }[] }).items[0]?.id ?? '';
    expect(id).not.toBe('');
  }).toPass({ timeout: 15_000 });
  return id;
}

test('a billing clerk matches a payment that came in without a reference', async ({ page, request }) => {
  await unmatchedPayment(request, 73_100);
  const account = await payerAccount(request);

  await page.goto('/');
  await page.getByRole('combobox', { name: 'Token' }).click();
  await page.getByRole('option', { name: 'dev-billing', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('link', { name: /^Money/ }).click();
  await expect(page.getByRole('heading', { name: 'Money', exact: true })).toBeVisible();

  const grid = page.getByRole('grid', { name: 'Unmatched payments' });
  const row = grid.getByRole('row').filter({ hasText: 'SEK 731.00' });
  await row.click();
  await expect(page.getByRole('heading', { name: 'Match the payment' })).toBeVisible();

  await page.getByRole('textbox', { name: 'Payer account or invoice' }).fill('pol_bella');
  await page.getByRole('button', { name: 'Match', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Give a payer account (bac_…) or an invoice (inv_…).');

  await page.getByRole('textbox', { name: 'Payer account or invoice' }).fill(account);
  await page.getByRole('textbox', { name: 'Why (optional)' }).fill('The payer named the policy in the message');
  await page.getByRole('button', { name: 'Match', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('The payment is matched.');
  await expect(row).toHaveCount(0);

  await page.getByRole('tab', { name: 'Held payouts' }).click();
  await expect(page.getByRole('grid', { name: 'Held payouts' })).toBeVisible();
  await page.getByRole('tab', { name: 'Credit proposals' }).click();
  await expect(page.getByRole('grid', { name: 'Credit proposals' })).toBeVisible();
  await page.getByRole('tab', { name: 'Recoveries' }).click();
  await expect(page.getByRole('grid', { name: 'Recoveries' })).toBeVisible();
});
