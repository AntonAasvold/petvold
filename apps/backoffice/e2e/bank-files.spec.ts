import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// A made-up camt.054 for the dev server's bankgiro 5050-1055: three booked credits.
const camt = fileURLToPath(new URL('../../../modules/payments/test/files/camt054-se.xml', import.meta.url));

test("a billing clerk reads in the bank's camt.054; its payments come in once", async ({ page }) => {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Token' }).click();
  await page.getByRole('option', { name: 'dev-billing', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('link', { name: /^Money/ }).click();
  await page.getByRole('tab', { name: 'Bank files' }).click();

  await page.getByRole('button', { name: 'Read in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Choose the file.');
  await page.locator('input[type=file]').setInputFiles(camt);
  await page.getByRole('button', { name: 'Read in', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('The file is read in.');
  const grid = page.getByRole('grid', { name: 'Bank files' });
  await expect(grid.getByRole('row').nth(1)).toContainText('ekonomi@example.test');

  // The same file again adds nothing.
  await page.locator('input[type=file]').setInputFiles(camt);
  await page.getByRole('button', { name: 'Read in', exact: true }).click();
  await expect(grid.getByRole('row')).toHaveCount(3);
  await grid.getByRole('row').nth(1).click();
  await expect(page.locator('.pv-dl__row').filter({ hasText: 'New payments' })).toContainText('0');
  await expect(page.locator('.pv-dl__row').filter({ hasText: 'Already read' })).toContainText('3');
});
