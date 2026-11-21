import { expect, test, type Page } from '@playwright/test';

const API = 'http://127.0.0.1:8797';

async function signIn(page: Page, token: string) {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Token' }).click();
  await page.getByRole('option', { name: token, exact: true }).click();
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation')).toBeVisible();
}

test('a policy is found by its id and by its policyholder, with terms, versions and history', async ({ page }) => {
  await signIn(page, 'dev-handler');
  await page.getByRole('link', { name: 'Policies' }).click();
  await page.getByRole('textbox', { name: 'Search' }).fill('pty_owner001');
  await page.getByRole('button', { name: 'Search' }).click();
  const grid = page.getByRole('grid', { name: 'Policies' });
  await expect(grid.getByRole('gridcell', { name: 'pol_bella' })).toBeVisible();
  await grid.getByRole('gridcell', { name: 'pol_bella' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Policy for Bella' })).toBeVisible();
  // The head names who and what, and the term shows how much of the annual limit is used.
  await expect(page.getByRole('link', { name: 'Anna Example' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'The term in force' })).toContainText('Left of the annual limit');
  await expect(page.getByRole('grid', { name: 'Claims on the policy' }).getByRole('row')).not.toHaveCount(1);
  await expect(page.getByRole('grid', { name: 'Terms' }).getByRole('row')).not.toHaveCount(1);
  await expect(page.getByRole('region', { name: 'History' }).getByRole('listitem').filter({ hasText: 'Issued' }).first()).toBeVisible();

  await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Policies' }).click();
  await page.getByRole('textbox', { name: 'Search' }).fill('Bella');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByText('Give a policy, animal or party id')).toBeVisible();
});

test('an underwriter decides a referred application; the grounds are required', async ({ page }) => {
  await signIn(page, 'dev-underwriter');
  await page.getByRole('link', { name: 'Applications' }).click();
  const grid = page.getByRole('grid', { name: 'Applications' });
  await expect(grid.getByRole('row').nth(1)).toContainText('ani_rocky');
  await grid.getByRole('row').nth(1).getByRole('gridcell').first().click();
  await expect(page.getByRole('heading', { name: /^Application app_/ })).toBeVisible();
  await expect(page.getByRole('grid', { name: 'The rules' }).getByRole('gridcell', { name: 'answer' }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Decide' }).click();
  await expect(page.getByRole('alert')).toContainText('Write the grounds for the decision.');
  await page.getByRole('textbox', { name: 'Grounds' }).fill('The vet record shows a cold, now over');
  await page.getByRole('button', { name: 'Decide' }).click();
  await expect(page.locator('wa-callout[role="status"]')).toContainText('Accepted. The policy is issued.');
  await expect(page.getByRole('link', { name: /^pol_/ })).toBeVisible();
});

test('a transfer to a new owner is accepted from the policy', async ({ page, request }) => {
  // Doris is sold to Sara in the animal register; the relay turns it into a proposal.
  const res = await request.post(`${API}/v1/animals/ani_doris/ownerships`, {
    headers: { authorization: 'Bearer dev-registrar', 'idempotency-key': `e2e-doris-${Date.now()}`, 'content-type': 'application/json' },
    data: { partyId: 'pty_owner003', from: new Date().toISOString().slice(0, 10), reason: 'Sold' },
  });
  expect(res.status()).toBe(201);

  await signIn(page, 'dev-seller');
  await page.getByRole('link', { name: 'Proposals' }).click();
  const grid = page.getByRole('grid', { name: 'Proposals' });
  // The relay runs every second. The token lives in memory, so the list is fetched again by leaving and coming back, not by reloading.
  await expect(async () => {
    await page.getByRole('link', { name: 'Policies' }).click();
    await page.getByRole('link', { name: 'Proposals' }).click();
    await expect(grid.getByRole('gridcell', { name: 'Transfer to a new owner' })).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  await grid.getByRole('gridcell', { name: 'Transfer to a new owner' }).click();
  await expect(page.getByRole('heading', { name: 'Transfer to a new owner' })).toBeVisible();
  await page.getByRole('button', { name: 'Accept' }).click();
  await expect(page.locator('wa-callout[role="status"]')).toContainText('Accepted.');
  await expect(page.getByRole('region', { name: 'History' }).getByRole('listitem').filter({ hasText: 'Transferred' })).toBeVisible();
});
