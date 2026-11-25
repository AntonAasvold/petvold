import { createHmac } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';

const API = 'http://127.0.0.1:8797';
// The dev server's fake bank secret (docs/funktion/premier.md). For development only.
const SECRET = 'whsec_cGV0dm9sZC1kZXYtZmFrZS1iYW5rcGV0dm9sZC1kZXY=';
const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

/** A payment booked yesterday, so there is a day with a verification to close. */
async function paymentYesterday(request: APIRequestContext) {
  const id = `fb_e2e_acc_${Date.now()}`;
  const body = JSON.stringify({ schema: 'petvold-fake-bank.v1', payments: [{ id, market: 'SE', currency: 'SEK', amount: 12_300, reference: null, bookedOn: yesterday }] });
  const ts = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', Buffer.from(SECRET.slice('whsec_'.length), 'base64')).update(`${id}.${ts}.${body}`).digest('base64');
  const res = await request.post(`${API}/provider-notifications/fake`, {
    headers: { 'content-type': 'application/json', 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': `v1,${signature}` },
    data: body,
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  // The relay takes it to accounting within a second or so.
  await expect(async () => {
    const list = await request.get(`${API}/v1/verifications?market=SE&from=${yesterday}&to=${yesterday}`, { headers: { authorization: 'Bearer dev-all' } });
    expect(((await list.json()) as { items: unknown[] }).items.length).toBeGreaterThan(0);
  }).toPass({ timeout: 15_000 });
}

test('an accountant reads a closed day, downloads its file and changes the chart of accounts', async ({ page, request }) => {
  await paymentYesterday(request);
  // Close the days before today, as the morning run does.
  const run = await request.post(`${API}/v1/jobs/accounting.day-close/runs`, {
    headers: { authorization: 'Bearer dev-operations', 'idempotency-key': `e2e-day-close-${Date.now()}` },
    data: { market: 'SE' },
  });
  expect(run.ok(), await run.text()).toBeTruthy();

  await page.goto('/');
  await page.getByRole('combobox', { name: 'Token' }).click();
  await page.getByRole('option', { name: 'dev-accountant', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: /^Bookkeeping/ }).click();
  await expect(page.getByRole('heading', { name: 'Bookkeeping', exact: true })).toBeVisible();

  await page.getByLabel('From').fill(new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10));
  await page.getByLabel('From').press('Enter');
  const days = page.getByRole('grid', { name: 'Day closes' });
  await expect(days.getByRole('row')).not.toHaveCount(1);
  await days.getByRole('row').nth(1).click();
  await expect(page.getByRole('heading', { name: /^Closed day/ })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download the file (CSV)' }).click();
  expect((await download).suggestedFilename()).toBe(`petvold-verifications-SE-${yesterday}.csv`);

  await page.getByRole('tab', { name: 'Chart of accounts' }).click();
  await expect(page.getByRole('heading', { name: 'Chart of accounts · SE' })).toBeVisible();
  const bank = page.locator('.chart-row').filter({ hasText: 'bank' }).first();
  await bank.getByRole('textbox', { name: 'Number' }).fill('19 30');
  await bank.getByRole('textbox', { name: 'Number' }).press('Tab');
  await page.getByRole('button', { name: 'Save a new version' }).click();
  await expect(page.getByRole('alert')).toContainText('a number is 1 to 20 letters, digits, dots or dashes.');
  await expect(page.getByRole('alert')).toContainText('Give a reason for the change.');

  await bank.getByRole('textbox', { name: 'Number' }).fill('1930');
  await bank.getByRole('textbox', { name: 'Number' }).press('Tab');
  await bank.getByRole('textbox', { name: 'Name' }).fill('Bank');
  await bank.getByRole('textbox', { name: 'Name' }).press('Tab');
  await page.getByRole('textbox', { name: 'Reason for the change' }).fill('Our chart from 1 December');
  await page.getByRole('button', { name: 'Save a new version' }).click();
  await expect(page.getByRole('status')).toContainText('Saved as a new version.');
  await expect(page.getByRole('region', { name: 'Versions' })).toContainText('Our chart from 1 December');
});
