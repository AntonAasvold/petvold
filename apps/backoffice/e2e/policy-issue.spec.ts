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
  await expect(form.getByText('Sixten')).toBeVisible();
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
