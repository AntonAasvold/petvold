import { expect, test } from '@playwright/test';

test('a catalog manager adds a breed with a suggested code, and changes it as a new revision with a reason', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Token' }).click();
  await page.getByRole('option', { name: 'dev-catalog', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Reference data' }).click();
  await page.getByRole('tab', { name: 'Breeds' }).click();
  const grid = page.getByRole('grid', { name: 'Breeds' });
  await expect(grid.getByRole('row').nth(1)).toBeVisible();

  await page.getByRole('combobox', { name: 'Species' }).click();
  await page.getByRole('option', { name: 'Dog' }).click();
  await page.getByRole('textbox', { name: 'Label (en)' }).fill('Kooikerhondje');
  await expect(page.getByRole('textbox', { name: 'Code' })).toHaveValue('dog-kooikerhondje');
  await page.getByRole('textbox', { name: 'Label (sv)' }).fill('Kooikerhondje');
  await page.getByRole('button', { name: 'Add the code' }).click();
  await expect(page.getByRole('status')).toContainText('The code is added.');
  await expect(page.getByRole('heading', { name: 'dog-kooikerhondje' })).toBeVisible();

  await page.getByRole('textbox', { name: 'Label (sv)' }).fill('Kooiker');
  await page.getByRole('button', { name: 'Save a new version' }).click();
  await expect(page.getByRole('alert')).toContainText('Give a reason for the change.');
  await page.getByRole('textbox', { name: 'Reason for the change' }).fill('The shorter Swedish name');
  await page.getByRole('button', { name: 'Save a new version' }).click();
  await expect(page.getByRole('status')).toContainText('Saved as a new revision.');
  await expect(grid.getByRole('row').filter({ hasText: 'dog-kooikerhondje' })).toContainText('Kooiker');
  await expect(page.locator('.pv-dl__row').filter({ hasText: 'Revision 2' })).toContainText('The shorter Swedish name');
});
