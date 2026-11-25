import { expect, test } from '@playwright/test';

test('the policy on a day: what the claims engine sees, and nothing before the policy began', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign in' }).click();
  const search = page.getByRole('searchbox', { name: 'Search for a claim, policy, animal or customer' });
  await search.fill('pol_bella');
  await search.press('Enter');
  const card = page.locator('pv-policy-snapshot');
  await expect(card.getByRole('heading', { name: 'The policy on a day' })).toBeVisible();

  await card.getByRole('button', { name: 'Show' }).click();
  await expect(card.locator('.pv-dl__row').filter({ hasText: 'Status' })).toContainText('Active');
  await expect(card.locator('.pv-dl__row').filter({ hasText: 'Annual limit' })).toContainText('60,000.00');
  await expect(card).toContainText('Riders:');

  await card.locator('wa-input[type="date"]').locator('input').fill('2000-01-01');
  await card.getByRole('button', { name: 'Show' }).click();
  await expect(card.getByRole('status')).toContainText('The policy was not in force that day');
});
