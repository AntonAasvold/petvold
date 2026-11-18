import { expect, test } from '@playwright/test';

// A claims handler registers a claim the customer sent in: from the policy's page,
// with a preview of the assessment before anything is stored.
test('a handler registers a claim from the policy, after a preview', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Claims' })).toBeVisible();
  await page.getByRole('button', { name: 'Register a claim' }).click();
  await expect(page).toHaveURL(/\/claims\/new$/);

  const form = page.locator('pv-claim-register');
  // Nothing is sent without a policy, and the form says what is missing.
  await form.getByRole('button', { name: /^Register the claim/ }).click();
  await expect(form.getByRole('alert')).toContainText('Fetch the policy first.');

  await form.getByRole('textbox', { name: 'Policy id' }).fill('pol_bella');
  await form.getByRole('button', { name: 'Fetch the policy' }).click();
  await expect(form.getByText('SE, SEK')).toBeVisible();

  await form.getByLabel('First day of treatment').fill('2026-11-10');
  await form.getByLabel('Last day of treatment').fill('2026-11-10');
  await form.getByRole('textbox', { name: 'Diagnosis' }).fill('ORT-KORSBAND-V');
  const line = form.getByRole('group', { name: 'Line 1' });
  await line.getByRole('textbox', { name: 'Description' }).fill('Examination');
  await line.getByRole('textbox', { name: 'Amount', exact: true }).fill('900');

  await form.getByRole('button', { name: 'Preview the assessment' }).click();
  const preview = form.getByRole('status', { name: 'Preview' });
  await expect(preview).toContainText('Proposal:');
  await expect(preview.getByRole('list', { name: 'Calculation' })).toBeVisible();

  await form.getByRole('button', { name: /^Register the claim · SEK 900\.00$/ }).click();
  // The server gives the id and the claim number from its series (ADR 0036).
  await expect(page).toHaveURL(/\/claims\/clm_[A-Za-z0-9_]+$/);
  await expect(page.getByRole('heading', { level: 1, name: /^Claim S-\d{4}-\d{6}$/ })).toBeVisible();
});

test('the policy page opens the form with the policy filled in', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign in' }).click();
  const search = page.getByRole('searchbox', { name: 'Search for a claim, policy, animal or customer' });
  await search.fill('pol_bella');
  await search.press('Enter');
  await page.getByRole('button', { name: 'Register a claim' }).click();
  await expect(page).toHaveURL(/\/claims\/new\?policy=pol_bella$/);
  await expect(page.locator('pv-claim-register').getByText('SE, SEK')).toBeVisible();
});
