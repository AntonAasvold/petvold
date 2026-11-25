import { expect, test } from '@playwright/test';

const API = 'http://127.0.0.1:8797';

test("a billing clerk opens a payer's account from the party and credits an invoice", async ({ page, request }) => {
  // Invoice what the sample policies have due, as the morning run does. Again
  // until it finds them: the relay makes the plans shortly after the server starts.
  await expect(async () => {
    const run = await request.post(`${API}/v1/jobs/billing.invoicing/runs`, {
      headers: { authorization: 'Bearer dev-operations', 'idempotency-key': `e2e-invoicing-${Date.now()}` },
      data: { market: 'SE' },
    });
    expect(run.ok(), await run.text()).toBeTruthy();
    const res = await request.get(`${API}/v1/invoices?market=SE`, { headers: { authorization: 'Bearer dev-all' } });
    expect(((await res.json()) as { items: { partyId: string }[] }).items.some((i) => i.partyId === 'pty_owner002')).toBe(true);
  }).toPass({ timeout: 15_000 });

  await page.goto('/');
  await page.getByRole('combobox', { name: 'Token' }).click();
  await page.getByRole('option', { name: 'dev-billing', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in' }).click();
  const search = page.getByRole('searchbox', { name: 'Search for a claim, policy, animal or customer' });
  await search.fill('pty_owner002');
  await search.press('Enter');

  const accounts = page.getByRole('grid', { name: 'Payer accounts' });
  await accounts.getByRole('row').filter({ hasText: 'SE · SEK' }).click();
  await expect(page.getByRole('heading', { name: 'Payer account', exact: true })).toBeVisible();

  const invoices = page.getByRole('grid', { name: 'Invoices' });
  await invoices.getByRole('row').nth(1).click();
  await expect(page.getByRole('heading', { name: /^Invoice SE-/ })).toBeVisible();

  await page.getByRole('textbox', { name: 'Amount', exact: true }).fill('abc');
  await page.getByRole('button', { name: 'Make it' }).click();
  await expect(page.getByRole('alert')).toContainText('Give an amount, e.g. 195,07.');
  await expect(page.getByRole('alert')).toContainText('Give a reason.');

  await page.getByRole('textbox', { name: 'Amount', exact: true }).fill('10');
  await page.getByRole('textbox', { name: 'Reason' }).fill('Goodwill after a complaint');
  await page.getByRole('button', { name: 'Make it' }).click();
  await expect(page.getByRole('status')).toContainText('Done. The credit note is made.');
  await expect(page.locator('pv-payer-account .pv-dl__row').filter({ hasText: 'Credited' })).toContainText('10.00');

  // Above the clerk's SEK 1,000: a proposal for someone else.
  await page.getByRole('radio', { name: /Write-off/ }).click();
  await page.getByRole('textbox', { name: 'Amount', exact: true }).fill('2000');
  await page.getByRole('textbox', { name: 'Reason' }).fill('The customer cannot pay');
  await page.getByRole('button', { name: 'Make it' }).click();
  await expect(page.getByRole('status')).toContainText('Above your limit');

  await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: /^Money/ }).click();
  await page.getByRole('tab', { name: 'Credit proposals' }).click();
  await page.getByRole('grid', { name: 'Credit proposals' }).getByRole('row').filter({ hasText: 'SEK 2,000.00' }).click();
  await expect(page.getByText('You proposed this. Someone else approves or returns it.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
});
