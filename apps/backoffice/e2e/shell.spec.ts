import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign in' }).click();
});

test('the top bar names Petvold and the back office, and the menu counts what waits', async ({ page }) => {
  const banner = page.getByRole('banner');
  await expect(banner).toContainText('Petvold');
  await expect(banner).toContainText('Back office');
  const nav = page.getByRole('navigation', { name: 'Sections' });
  const claims = nav.getByRole('link', { name: /^Claims/ });
  await expect(claims).toHaveAttribute('aria-current', 'page');
  // Sixten's refusal lacks the review text and stays in the notices that need a person.
  await expect(nav.getByRole('link', { name: /^Notices/ }).locator('.pv-nav__count')).toHaveText(/^\d+\+?$/);
  // The selected item is ink on paper: the design system's inverted state.
  const bg = await claims.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe('rgb(0, 0, 0)');
});

test('the top bar search opens a claim and a party by id, and the party shows its policies', async ({ page }) => {
  const search = page.getByRole('searchbox', { name: 'Search for a claim, policy, animal or customer' });
  await search.fill('clm_021877');
  await search.press('Enter');
  await expect(page).toHaveURL(/\/claims\/clm_021877$/);
  await search.fill('pty_owner001');
  await search.press('Enter');
  await expect(page).toHaveURL(/\/parties\/pty_owner001$/);
  await expect(page.getByRole('grid', { name: 'Policies as policyholder' }).getByRole('gridcell', { name: 'pol_bella' })).toBeVisible();
});

test('dev-all has every section of the back office in the menu', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Token' }).click();
  await page.getByRole('option', { name: 'dev-all', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in' }).click();
  const menu = page.getByRole('navigation', { name: 'Sections' });
  for (const section of ['Claims', 'Policies', 'Parties', 'Animals', 'Erasure', 'Applications', 'Proposals', 'Notices', 'Webhooks', 'Runs', 'Products', 'Rule sets', 'Settings']) {
    await expect(menu.getByRole('link', { name: new RegExp(`^${section}`) })).toBeVisible();
  }
});
