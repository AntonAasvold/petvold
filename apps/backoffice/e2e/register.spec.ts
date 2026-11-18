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

test('a registered claim is dismissed as a duplicate, and the queue shows it closed (ADR 0036)', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: 'Register a claim' }).click();
  const form = page.locator('pv-claim-register');
  await form.getByRole('textbox', { name: 'Policy id' }).fill('pol_bella');
  await form.getByRole('button', { name: 'Fetch the policy' }).click();
  await expect(form.getByText('SE, SEK')).toBeVisible();
  await form.getByLabel('First day of treatment').fill('2026-11-11');
  await form.getByLabel('Last day of treatment').fill('2026-11-13');
  await form.getByRole('textbox', { name: 'Diagnosis' }).fill('ORT-KORSBAND-V');
  const line = form.getByRole('group', { name: 'Line 1' });
  await line.getByRole('textbox', { name: 'Description' }).fill('Same invoice again');
  await line.getByRole('textbox', { name: 'Amount', exact: true }).fill('700');
  await form.getByRole('button', { name: /^Register the claim/ }).click();
  const heading = page.getByRole('heading', { level: 1, name: /^Claim S-/ });
  await expect(heading).toBeVisible();
  const claimNo = (await heading.textContent())!.replace('Claim ', '').trim();

  const actions = page.locator('pv-claim-actions');
  await actions.getByRole('radio', { name: /^Dismiss/ }).check();
  await actions.getByRole('combobox', { name: 'Why' }).click();
  await page.getByRole('option', { name: 'Duplicate of another claim' }).click();
  // The form says what is missing before anything is sent.
  await actions.getByRole('button', { name: 'Dismiss the claim' }).click();
  await expect(actions.getByRole('alert')).toContainText('Give the id of the claim it duplicates');
  await actions.getByRole('textbox', { name: 'Duplicate of' }).fill('clm_048213');
  await actions.getByRole('textbox', { name: 'Reason' }).fill('The customer sent the same invoice twice.');
  await actions.getByRole('button', { name: 'Dismiss the claim' }).click();

  await expect(actions.getByRole('heading', { name: 'Dismissed' })).toBeVisible();
  await expect(actions.getByRole('heading', { name: 'Decision', exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'History' }).getByRole('listitem').first()).toContainText('claim.dismissed');

  await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Claims' }).click();
  await page.getByRole('tab', { name: 'Dismissed' }).click();
  await expect(page.getByRole('grid', { name: 'Claims' }).getByRole('gridcell', { name: claimNo })).toBeVisible();
});
