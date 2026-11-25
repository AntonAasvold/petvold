import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page, token: string) {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Token' }).click();
  await page.getByRole('option', { name: token, exact: true }).click();
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
}

test('the start page is the overview: a handler sees the claims queues and opens one', async ({ page }) => {
  await signIn(page, 'dev-handler');
  const nav = page.getByRole('navigation', { name: 'Sections' });
  await expect(nav.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
  // Earlier tests decide the sample claims, so the queue may be empty by now: only that it is there.
  const decide = page.locator('a.queue').filter({ hasText: 'Claims to decide' });
  await expect(decide.locator('.count')).toHaveText(/^\d+\+?$/);
  await expect(page.locator('a.queue').filter({ hasText: 'Unmatched payments' })).toHaveCount(0, { timeout: 1000 });
  await decide.click();
  await expect(page).toHaveURL(/\/claims\?tab=awaiting-decision$/);
  await expect(page.getByRole('tab', { name: 'Awaiting decision' })).toHaveAttribute('aria-selected', 'true');
});

test('finance sees the money queues, and a card opens its tab', async ({ page }) => {
  await signIn(page, 'dev-billing');
  const recoveries = page.locator('a.queue').filter({ hasText: 'Recoveries' });
  await expect(recoveries).toContainText('Nothing waits');
  await expect(page.locator('a.queue').filter({ hasText: 'Claims to decide' })).toHaveCount(0);
  await recoveries.click();
  await expect(page).toHaveURL(/\/money\?tab=recoveries$/);
  await expect(page.getByRole('tab', { name: 'Recoveries' })).toHaveAttribute('aria-selected', 'true');
});
