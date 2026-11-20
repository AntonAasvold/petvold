import { expect, test } from '@playwright/test';

// A seller issues a policy from the animal's page, then cancels it within the
// cooling-off period and reverses the cancellation (ADR 0029, 0031).
test('a policy is issued from the animal, cancelled and the cancellation reversed', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Token' }).click();
  await page.getByRole('option', { name: 'dev-seller', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in' }).click();
  const search = page.getByRole('searchbox', { name: 'Search for a claim, policy, animal or customer' });
  await search.fill('ani_sixten');
  await search.press('Enter');
  await page.getByRole('button', { name: 'Issue a policy' }).click();
  await expect(page).toHaveURL(/\/policies\/new\?animal=ani_sixten&holder=pty_owner004$/);

  const form = page.locator('pv-policy-issue');
  await expect(form.locator('.who')).toContainText('Sixten');
  await form.getByRole('combobox', { name: 'Product version on sale' }).click();
  await page.getByRole('option', { name: /SE-HUND-VV-LIV@2026\.2/ }).click();
  // No tariff: the premium is given by hand, and the form says so before sending.
  await form.getByRole('button', { name: /^Issue the policy/ }).click();
  await expect(form.getByRole('alert')).toContainText('Give the premium as an amount');
  await form.getByRole('textbox', { name: 'Premium per term' }).fill('3 600');
  await form.getByRole('textbox', { name: 'Reference (optional)' }).fill('Call 2026-11-19');
  await form.getByRole('button', { name: /^Issue the policy/ }).click();

  await expect(page).toHaveURL(/\/policies\/pol_/);
  await expect(page.getByRole('heading', { name: /^Policy pol_/ })).toBeVisible();

  const actions = page.locator('pv-policy-actions');
  await actions.getByRole('button', { name: 'Cancel the policy' }).click();
  await actions.getByRole('combobox', { name: 'Reason' }).click();
  await page.getByRole('option', { name: 'Withdrawal within the cooling-off period' }).click();
  await actions.getByRole('region', { name: 'Cancel the policy' }).getByRole('button', { name: 'Cancel the policy' }).click();
  await expect(actions.getByRole('status')).toContainText('The policy is cancelled.');

  await actions.getByRole('button', { name: 'Reverse the cancellation' }).click();
  await actions.getByRole('region', { name: 'Reverse the cancellation' }).getByRole('button', { name: 'Reverse the cancellation' }).click();
  await expect(actions.getByRole('alert')).toContainText('Write a note.');
  await actions.getByRole('textbox', { name: 'Note, without personal data' }).fill('Withdrawn by mistake on the phone');
  await actions.getByRole('region', { name: 'Reverse the cancellation' }).getByRole('button', { name: 'Reverse the cancellation' }).click();
  await expect(actions.getByRole('status')).toContainText('The cancellation is reversed.');
  await expect(page.getByRole('grid', { name: 'History' }).getByRole('row')).toHaveCount(4);
});

test("a policy is started from the customer's page, choosing among the customer's animals", async ({ page }) => {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Token' }).click();
  await page.getByRole('option', { name: 'dev-seller', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in' }).click();
  const search = page.getByRole('searchbox', { name: 'Search for a claim, policy, animal or customer' });
  await search.fill('pty_owner004');
  await search.press('Enter');
  await page.getByRole('region', { name: 'Policies as policyholder' }).getByRole('button', { name: 'Issue a policy' }).click();
  await expect(page).toHaveURL(/\/policies\/new\?holder=pty_owner004$/);

  const form = page.locator('pv-policy-issue');
  await form.getByRole('combobox', { name: "The policyholder's animals" }).click();
  await page.getByRole('option', { name: /^Sixten/ }).click();
  await expect(form.getByRole('textbox', { name: 'Animal id' })).toHaveValue('ani_sixten');
  await expect(form.getByRole('combobox', { name: 'Product version on sale' })).toBeVisible();

  // An animal that is insured already says so, with the day a new policy may start.
  await form.getByRole('textbox', { name: 'Animal id' }).fill('ani_bella');
  await form.getByRole('textbox', { name: 'Animal id' }).press('Tab');
  await expect(form.getByRole('status').filter({ hasText: 'The animal is insured already by' })).toContainText('pol_bella');

  // The policies page has the same way in.
  await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Policies' }).click();
  await page.getByRole('button', { name: 'Issue a policy' }).click();
  await expect(page).toHaveURL(/\/policies\/new$/);
});
