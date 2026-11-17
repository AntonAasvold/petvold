import { expect, test } from '@playwright/test';

// The browser speaks English; the last test switches to Swedish.
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign in' }).click();
});

test('a handler sees the claims queue and opens a claim with its assessment', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Claims' })).toBeVisible();
  const grid = page.getByRole('grid', { name: 'Claims' });
  await expect(grid.getByRole('row').nth(1)).toContainText('Awaiting decision');
  await grid.getByRole('gridcell').first().click();
  await expect(page).toHaveURL(/\/claims\/clm_/);
  await expect(page.getByRole('heading', { level: 1, name: /^Claim / })).toBeVisible();
  // The head: breadcrumb, the id that copies, and who and what the claim concerns.
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Claims' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Copy the id clm_/ })).toBeVisible();
  await expect(page.getByText('Animal:')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Decision', exact: true })).toBeVisible();
  await expect(page.getByRole('grid', { name: 'Assessment' }).getByRole('gridcell', { name: 'POLICY_FOUND' })).toBeVisible();
});

test('the queue is used with the keyboard: arrows move, Enter opens', async ({ page }) => {
  const grid = page.getByRole('grid', { name: 'Claims' });
  await grid.getByRole('gridcell').first().focus();
  await page.keyboard.press('ArrowRight');
  await expect(grid.getByRole('gridcell').nth(1)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/claims\/clm_/);
});

test('the other queues, and Swedish', async ({ page }) => {
  await page.getByRole('tab', { name: 'Decided' }).click();
  await expect(page.getByRole('grid', { name: 'Claims' }).getByRole('row').nth(1)).toContainText('Decided');
  await page.getByRole('combobox', { name: 'Language' }).click();
  await page.getByRole('option', { name: 'Svenska' }).click();
  await expect(page.getByRole('heading', { name: 'Skador' })).toBeVisible();
  await expect(page.getByRole('grid', { name: 'Skador' }).getByRole('row').nth(1)).toContainText('Beslutad');
});

test('signing out returns to the login', async ({ page }) => {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
});
