import { expect, test, type Page } from '@playwright/test';

// Runs last (files run in name order): a changed limit would affect the claims tests.
async function signIn(page: Page, token: string) {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Token' }).click();
  await page.getByRole('option', { name: token, exact: true }).click();
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
}

const saved = (page: Page) => page.locator('wa-callout[role="status"]');

test('an admin raises a handler limit as a new version, with a reason', async ({ page }) => {
  await signIn(page, 'dev-admin');
  const grid = page.getByRole('grid', { name: 'Roles and limits' });
  const handler = grid.getByRole('row').filter({ has: page.getByRole('gridcell', { name: 'handler', exact: true }) });
  await expect(handler).toContainText('SEK 25,000.00');
  await page.getByRole('combobox', { name: 'Role' }).click();
  await page.getByRole('option', { name: 'handler', exact: true }).click();
  await page.getByRole('textbox', { name: 'Amount' }).fill('30000');
  await page.getByRole('button', { name: 'Save a new version' }).click();
  await expect(page.getByRole('alert')).toContainText('Give a reason for the change.');
  await page.getByRole('textbox', { name: 'Reason for the change' }).fill('New limits from 1 December');
  await page.getByRole('button', { name: 'Save a new version' }).click();
  await expect(saved(page)).toContainText('Saved as a new version.');
  await expect(handler).toContainText('SEK 30,000.00');
  await expect(page.getByRole('grid', { name: 'Versions' }).getByRole('row').nth(1)).toContainText('New limits from 1 December');
});

test('a privacy officer changes the retention; a market must be two capital letters', async ({ page }) => {
  await signIn(page, 'dev-privacy');
  await page.getByRole('textbox', { name: 'Years' }).first().fill('11');
  await page.getByRole('button', { name: 'Add a market' }).click();
  await page.getByRole('textbox', { name: 'Market' }).last().fill('N');
  await page.getByRole('textbox', { name: 'Years' }).last().fill('10');
  await page.getByRole('textbox', { name: 'Reason for the change' }).fill('Legal review');
  await page.getByRole('button', { name: 'Save a new version' }).click();
  await expect(page.getByRole('alert')).toContainText('A market is two capital letters');
  await page.getByRole('textbox', { name: 'Market' }).last().fill('NO');
  await page.getByRole('button', { name: 'Save a new version' }).click();
  await expect(saved(page)).toContainText('Saved as a new version.');
  await expect(page.getByRole('textbox', { name: 'Market' })).toHaveCount(2);
});

test("communications writes the insurer's text on how a decision is reviewed", async ({ page }) => {
  await signIn(page, 'dev-communications');
  await page.getByRole('textbox', { name: 'How a decision is reviewed (en)' }).fill('Contact our complaints function first.');
  await page.getByRole('textbox', { name: 'Reason for the change' }).fill('Texts for refusals');
  await page.getByRole('button', { name: 'Save a new version' }).click();
  await expect(saved(page)).toContainText('Saved as a new version.');
  await expect(page.getByRole('textbox', { name: 'How a decision is reviewed (en)' })).toHaveValue('Contact our complaints function first.');
});
