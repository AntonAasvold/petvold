import { expect, test } from '@playwright/test';

// The documentation is in Swedish whatever the interface's language; the test
// goes by rule ids and addresses, which are the same in both.
test('anyone signed in searches the documentation for a rule and opens it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Token' }).click();
  await page.getByRole('option', { name: 'dev-handler', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('link', { name: 'Documentation' }).click();
  await expect(page).toHaveURL(/\/docs$/);
  await expect(page.locator('pv-docs article h1')).toBeVisible();

  await page.getByRole('searchbox', { name: 'Search the documentation' }).fill('OBET-05');
  await expect(page).toHaveURL(/\?q=OBET-05/);
  const hit = page.locator('pv-docs .hits a').first();
  await expect(hit).toHaveAttribute('href', '/docs/processer/obetald-premie#regler');
  await hit.click();
  await expect(page).toHaveURL(/\/docs\/processer\/obetald-premie#regler$/);
  await expect(page.locator('pv-docs article')).toContainText('OBET-05');

  await page.getByRole('searchbox', { name: 'Search the documentation' }).fill('zzqx');
  await expect(page.locator('pv-docs')).toContainText('Nothing matches every word.');
});
