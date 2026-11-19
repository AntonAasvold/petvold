import { expect, test } from '@playwright/test';

// A registrar registers an animal from the owner's page, corrects it and changes its owner (ADR 0024).
test('an animal is registered from its owner, corrected with a reason and given a new owner', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Token' }).click();
  await page.getByRole('option', { name: 'dev-registrar', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in' }).click();
  const search = page.getByRole('searchbox', { name: 'Search for a claim, policy, animal or customer' });
  await search.fill('pty_owner001');
  await search.press('Enter');
  await expect(page.getByRole('grid', { name: 'Animals owned today' }).getByRole('gridcell', { name: 'Bella' }).first()).toBeVisible();
  await page.getByRole('region', { name: 'Animals owned today' }).getByRole('button', { name: 'Register an animal' }).click();
  await expect(page).toHaveURL(/\/animals\/new\?owner=pty_owner001$/);

  const form = page.locator('pv-animal-register');
  await expect(form.getByRole('textbox', { name: 'Owner (party id)' })).toHaveValue('pty_owner001');
  await form.getByRole('button', { name: 'Register the animal' }).click();
  await expect(form.getByRole('alert')).toContainText('Choose the species.');
  await form.getByRole('combobox', { name: 'Species' }).click();
  await page.getByRole('option', { name: 'Dog' }).click();
  await form.getByRole('combobox', { name: 'Breed (optional)' }).click();
  await page.getByRole('option', { name: 'Labrador Retriever' }).click();
  await form.getByRole('combobox', { name: 'Sex' }).click();
  await page.getByRole('option', { name: 'Male', exact: true }).click();
  await form.getByRole('textbox', { name: 'Name' }).fill('Bosse');
  await form.getByLabel('Date of birth').fill('2025-03-01');
  await form.getByRole('textbox', { name: 'Microchip (optional)' }).fill('752 098 100 999 001');
  await form.getByRole('button', { name: 'Register the animal' }).click();

  await expect(page).toHaveURL(/\/animals\/ani_/);
  await expect(page.getByRole('heading', { level: 1, name: 'Bosse' })).toBeVisible();
  await expect(page.getByText('752098100999001')).toBeVisible();

  const detail = page.locator('pv-animal-detail');
  await detail.getByRole('button', { name: 'Correct the details' }).click();
  // Web Awesome's checkbox hides its native input; the component itself takes the click.
  await detail.locator('wa-checkbox', { hasText: 'Neutered' }).click();
  await detail.getByRole('textbox', { name: 'Reason', exact: true }).fill('Neutered at the clinic');
  await detail.getByRole('button', { name: 'Save the change' }).click();
  await expect(detail.getByRole('status')).toContainText('The details are changed.');
  await expect(detail.getByText('Male, neutered')).toBeVisible();

  await detail.getByRole('textbox', { name: 'New owner (party id)' }).fill('pty_owner001');
  await detail.getByRole('button', { name: 'Change the owner' }).click();
  await expect(detail.getByRole('alert')).toContainText('That party already owns the animal.');

  const history = page.getByRole('region', { name: 'History' });
  await expect(history.getByRole('listitem')).toHaveCount(2);
  await expect(history.getByRole('listitem').first()).toContainText('Neutered at the clinic');
});
