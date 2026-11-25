import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page, token: string) {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Token' }).click();
  await page.getByRole('option', { name: token, exact: true }).click();
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test("a billing clerk gives a customer's payout details; the number is masked", async ({ page }) => {
  await signIn(page, 'dev-billing');
  const search = page.getByRole('searchbox', { name: 'Search for a claim, policy, animal or customer' });
  await search.fill('pty_owner003');
  await search.press('Enter');

  const card = page.locator('pv-payee-accounts');
  await expect(card.getByRole('heading', { name: 'Payout details' })).toBeVisible();
  await card.getByRole('button', { name: 'Give new details' }).click();
  await card.getByRole('textbox', { name: 'Clearing number' }).fill('83');
  await card.getByRole('textbox', { name: 'Account number' }).fill('123 456 789');
  await card.getByRole('button', { name: 'Save the details' }).click();
  await expect(card.getByRole('alert')).toContainText('The clearing number has 4 or 5 digits.');

  await card.getByRole('textbox', { name: 'Clearing number' }).fill('8327-9');
  await card.getByRole('button', { name: 'Save the details' }).click();
  await expect(card.getByRole('status')).toContainText('Saved.');
  const row = card.getByRole('grid', { name: 'Payout details' }).getByRole('row').nth(1);
  await expect(row).toContainText('In use');
  await expect(row).not.toContainText('123456789');
  await expect(row).toContainText('6789');
});

test('a billing clerk makes an agreement on direct settlement with a clinic, and ends it', async ({ page }) => {
  await signIn(page, 'dev-billing');
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: /^Money/ }).click();
  await page.getByRole('tab', { name: 'Clinics' }).click();

  await page.getByRole('button', { name: 'Make the agreement' }).click();
  await expect(page.getByRole('alert')).toContainText("Give the clinic's id.");
  await page.getByRole('textbox', { name: 'Clinic', exact: true }).fill('clinic-e2e-djurkliniken');
  await page.getByRole('button', { name: 'Make the agreement' }).click();
  await expect(page.getByRole('status')).toContainText('The agreement is made.');

  const grid = page.getByRole('grid', { name: 'Clinics' });
  const row = grid.getByRole('row').filter({ hasText: 'clinic-e2e-djurkliniken' });
  await expect(row).toContainText('In force');
  await row.click();
  await expect(page.getByRole('heading', { name: 'Agreement clinic-e2e-djurkliniken' })).toBeVisible();
  await expect(page.locator('pv-payee-accounts').getByRole('heading', { name: 'Payout details' })).toBeVisible();

  const next = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel('Ends on (not included)').fill(next);
  await page.getByRole('textbox', { name: 'Reason' }).fill('The clinic closes');
  await page.getByRole('button', { name: 'End the agreement' }).click();
  await expect(page.getByRole('status')).toContainText('The agreement is ended.');
});
