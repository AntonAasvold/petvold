import { expect, test } from '@playwright/test';

// A registrar registers a person, changes the details with a reason, and sees the history (ADR 0026).
test('a party is registered, changed with a reason, and every change is in the history', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Token' }).click();
  await page.getByRole('option', { name: 'dev-registrar', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: /^Parties/ }).click();
  await page.getByRole('button', { name: 'Register a party' }).click();

  const form = page.locator('pv-party-register');
  // What is missing is said before anything is sent.
  await form.getByRole('button', { name: 'Register the party' }).click();
  await expect(form.getByRole('alert')).toContainText('Give the given name and the family name.');
  await form.getByRole('textbox', { name: 'Given name' }).fill('Eva');
  await form.getByRole('textbox', { name: 'Family name' }).fill('Lind');
  await form.getByRole('textbox', { name: 'Phone' }).fill('+46 70 123 45 67');
  await form.getByRole('textbox', { name: 'Street' }).fill('Storgatan 1');
  await form.getByRole('button', { name: 'Register the party' }).click();
  await expect(form.getByRole('alert')).toContainText('Give the whole address');
  await form.getByRole('textbox', { name: 'Postal code' }).fill('111 22');
  await form.getByRole('textbox', { name: 'City' }).fill('Stockholm');
  await form.getByRole('button', { name: 'Register the party' }).click();

  await expect(page).toHaveURL(/\/parties\/pty_/);
  await expect(page.getByRole('heading', { level: 1, name: 'Eva Lind' })).toBeVisible();
  await expect(page.getByText('+46701234567')).toBeVisible();

  const detail = page.locator('pv-party-detail');
  await detail.getByRole('button', { name: 'Change the details' }).click();
  await detail.getByRole('textbox', { name: 'City' }).fill('Uppsala');
  await detail.getByRole('button', { name: 'Save the change' }).click();
  await expect(detail.getByRole('alert')).toContainText('Give a reason for the change.');
  await detail.getByRole('textbox', { name: 'Reason' }).fill('Moved, the customer called');
  await detail.getByRole('button', { name: 'Save the change' }).click();
  await expect(detail.getByRole('status')).toContainText('The details are changed.');
  await expect(detail.getByText('Storgatan 1, 111 22 Uppsala, SE')).toBeVisible();
  const history = page.getByRole('region', { name: 'History' });
  await expect(history.getByRole('listitem')).toHaveCount(2);
  await expect(history.getByRole('listitem').first()).toContainText('Moved, the customer called');
});
