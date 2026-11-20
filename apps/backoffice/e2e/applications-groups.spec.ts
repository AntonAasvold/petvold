import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page, token: string) {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Token' }).click();
  await page.getByRole('option', { name: token, exact: true }).click();
  await page.getByRole('button', { name: 'Sign in' }).click();
}

async function open(page: Page, id: string) {
  const search = page.getByRole('searchbox', { name: 'Search for a claim, policy, animal or customer' });
  await search.fill(id);
  await search.press('Enter');
}

// A product with health questions takes an application (ADR 0031): the answers go with it.
test('an application answers the health questions and opens with the outcome', async ({ page }) => {
  await signIn(page, 'dev-seller');
  await open(page, 'ani_sixten');
  await page.getByRole('button', { name: 'Issue a policy' }).click();
  const form = page.locator('pv-policy-issue');
  await expect(form.locator('.who')).toContainText('Sixten');
  await form.getByRole('combobox', { name: 'Product version on sale' }).click();
  await page.getByRole('option', { name: /SE-HUND-PLUS/ }).click();
  const health = form.getByRole('region', { name: 'Health questions' });
  await expect(health.getByRole('group').first()).toBeVisible();

  await form.getByRole('button', { name: /^Send the application/ }).click();
  await expect(form.getByRole('alert')).toContainText('Answer every health question.');
  await expect(form.getByRole('alert')).toContainText('Tick that the customer was shown the terms');
  const questions = await health.getByRole('group').count();
  for (let i = 0; i < questions; i++) await health.getByRole('group').nth(i).getByRole('radio', { name: 'No' }).check();
  for (const doc of ['Terms (sv)', 'Pre-contract information (sv)']) await form.locator('wa-checkbox', { hasText: doc }).click();

  await form.getByRole('button', { name: 'Price indication' }).click();
  await expect(form.getByRole('status', { name: 'Price' })).toContainText('The answers would give');
  await form.getByRole('button', { name: /^Send the application/ }).click();
  await expect(page).toHaveURL(/\/applications\/app_/);
});

// A household groups the policies one policyholder holds (ADR 0007).
test('a household is created for a policyholder, a policy joins and leaves it', async ({ page }) => {
  await signIn(page, 'dev-seller');
  await open(page, 'pty_owner002');
  const policyId = (await page.getByRole('grid', { name: 'Policies as policyholder' }).getByRole('gridcell').first().textContent())!.trim();
  await page.getByRole('region', { name: 'Groups' }).getByRole('button', { name: 'Create the group' }).click();
  await expect(page).toHaveURL(/\/groups\/pgr_/);
  await expect(page.getByRole('heading', { level: 1, name: 'Household' })).toBeVisible();

  await page.getByRole('textbox', { name: 'Policy id' }).fill(policyId);
  await page.getByRole('button', { name: 'Add a policy' }).last().click();
  await expect(page.getByRole('status')).toContainText('The policy is in the group.');
  const members = page.getByRole('grid', { name: 'Members' });
  await expect(members.getByRole('gridcell', { name: policyId })).toBeVisible();

  await members.getByRole('button', { name: 'End the membership' }).click();
  await page.getByRole('textbox', { name: 'Reason' }).fill('The customer asked');
  await page.getByRole('region', { name: /^End the membership/ }).getByRole('button', { name: 'End the membership' }).click();
  await expect(page.getByRole('status')).toContainText('The membership is ended.');
  await expect(members).toContainText('The customer asked');
});
