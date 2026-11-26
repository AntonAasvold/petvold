import { expect, test } from '@playwright/test';

test('a rules author tries a version against the stored decisions; the published rules change none of them', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Token' }).click();
  await page.getByRole('option', { name: 'dev-author', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: /^Rule sets/ }).click();
  await page.getByRole('grid').getByRole('row').filter({ hasText: 'SE-HUND-VV' }).click();
  const card = page.locator('pv-rule-simulation');
  await expect(card.getByRole('heading', { name: 'Try a version against stored decisions' })).toBeVisible();
  await card.getByRole('button', { name: 'Try it' }).click();
  await expect(card.locator('.pv-dl__row').filter({ hasText: 'Decisions tried' })).not.toContainText(/\b0\b/);
  await expect(card.locator('.pv-dl__row').filter({ hasText: 'Would change' })).toContainText('0');
  await expect(card).toContainText('No decision would change.');
});
