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
  await detail.getByRole('textbox', { name: 'Reason', exact: true }).fill('Moved, the customer called');
  await detail.getByRole('button', { name: 'Save the change' }).click();
  await expect(detail.getByRole('status')).toContainText('The details are changed.');
  await expect(detail.getByText('Storgatan 1, 111 22 Uppsala, SE')).toBeVisible();
  const history = page.getByRole('region', { name: 'History' });
  await expect(history.getByRole('listitem')).toHaveCount(2);
  await expect(history.getByRole('listitem').first()).toContainText('Moved, the customer called');
});

async function signInAs(page: import('@playwright/test').Page, token: string) {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Token' }).click();
  await page.getByRole('option', { name: token, exact: true }).click();
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: /^Parties/ }).click();
}

// ADR 0039: a party is found by name, a number is removed, the processing restricted and lifted, and the party ended and reopened.
test('a party is found by name, and its number removed, its processing restricted and the party ended and reopened', async ({ page }) => {
  await signInAs(page, 'dev-all');
  await page.getByRole('textbox', { name: 'Name or email' }).fill('erik');
  await page.getByRole('button', { name: 'Search' }).click();
  const found = page.getByRole('grid', { name: 'Parties found' });
  await expect(found.getByRole('row').filter({ hasText: 'Erik' })).toHaveCount(1);

  await page.getByRole('button', { name: 'Register a party' }).click();
  const form = page.locator('pv-party-register');
  await form.getByRole('textbox', { name: 'Given name' }).fill('Nils');
  await form.getByRole('textbox', { name: 'Family name' }).fill('Testsson');
  await form.getByRole('button', { name: 'Register the party' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Nils Testsson' })).toBeVisible();
  const detail = page.locator('pv-party-detail');

  // A number added by mistake is removed with a reason and stays as history.
  // The numbers are part of the details; the form opens on request.
  const details = detail.getByRole('region', { name: 'Details' });
  await details.getByRole('button', { name: 'Add a number' }).click();
  await details.getByRole('textbox', { name: 'Value' }).fill('20990303-1004');
  await detail.getByRole('button', { name: 'Add the number' }).click();
  await expect(detail.getByRole('status')).toContainText('The number is added.');
  await detail.getByRole('button', { name: 'Remove', exact: true }).click();
  await detail.getByRole('button', { name: 'Remove the number' }).click();
  await expect(detail.getByRole('alert')).toContainText('reason');
  await detail.getByRole('textbox', { name: 'Reason, without personal data' }).first().fill('Added to the wrong party');
  await detail.getByRole('button', { name: 'Remove the number' }).click();
  await expect(detail.getByRole('status')).toContainText('The number is removed.');
  await expect(details.getByText('Personal number (SE)', { exact: true })).toHaveCount(0);
  await expect(detail.getByText('Removed numbers (1)')).toBeVisible();

  // Restricted and lifted (GDPR article 18).
  const restriction = detail.getByRole('region', { name: 'Restriction' });
  await restriction.getByLabel('Restricted until').fill('2099-01-31');
  await restriction.getByRole('textbox', { name: 'Reason, without personal data' }).fill('The customer contests the details');
  await restriction.getByRole('button', { name: 'Restrict the processing' }).click();
  await expect(detail.getByRole('status')).toContainText('The processing is restricted.');
  await restriction.getByRole('textbox', { name: 'Reason, without personal data' }).fill('Checked with the customer');
  await restriction.getByRole('button', { name: 'Lift the restriction' }).click();
  await expect(detail.getByRole('status')).toContainText('The restriction is lifted.');

  // Ended, then reopened.
  const ending = detail.getByRole('region', { name: 'End the party' });
  await ending.getByRole('combobox', { name: 'Cause' }).click();
  await page.getByRole('option', { name: 'Deceased' }).click();
  await ending.getByLabel('Date').fill('2026-01-02');
  await ending.getByRole('textbox', { name: 'Reason, without personal data' }).fill('Death certificate received');
  await ending.getByRole('button', { name: 'End the party' }).click();
  await expect(detail.getByRole('status')).toContainText('The party is ended.');
  await expect(page.getByText('Ended 2026-01-02')).toBeVisible();
  const ended = detail.getByRole('region', { name: 'Ended' });
  await ended.getByRole('textbox', { name: 'Reason for reopening' }).fill('Ended by mistake');
  await ended.getByRole('button', { name: 'Reopen the party' }).click();
  await expect(detail.getByRole('status')).toContainText('The party is reopened.');
  await expect(detail.getByRole('region', { name: 'End the party' })).toBeVisible();
});

// The animals on a person's page say which policy insures them, and an uninsured one is insured from there.
test('a person\'s animals show their policy, and an uninsured animal is insured from the person\'s page', async ({ page }) => {
  await signInAs(page, 'dev-all');
  await page.getByRole('combobox', { name: 'By' }).click();
  await page.getByRole('option', { name: 'Party id' }).click();
  await page.getByRole('textbox', { name: 'Party id' }).fill('pty_owner003');
  await page.getByRole('button', { name: 'Search' }).click();
  const animals = page.getByRole('grid', { name: 'Animals owned today' });
  await expect(animals.getByRole('row').filter({ hasText: 'Max' }).getByRole('link', { name: /^pol_/ })).toBeVisible();
  await animals.getByRole('row').filter({ hasText: 'Smilla' }).getByRole('button', { name: 'Issue a policy' }).click();
  await expect(page).toHaveURL(/\/policies\/new\?animal=ani_smilla&holder=pty_owner003/);
});
