import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page, token: string) {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Token' }).click();
  await page.getByRole('option', { name: token, exact: true }).click();
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation')).toBeVisible();
}

const notice = (page: Page) => page.locator('wa-callout[role="status"]');

test('the document system sees what needs a person and reports a delivery', async ({ page }) => {
  await signIn(page, 'dev-documents');
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Notices' }).click();
  // Sixten's refusal lacks the insurer's text on review, so it waits for a person.
  const grid = page.getByRole('grid', { name: 'Notices' });
  // The flow for applications may add a second decline for Sixten; both lack the review text.
  await expect(grid.getByRole('row').filter({ hasText: 'Application declined' }).first()).toContainText('Text missing');

  await page.getByRole('tab', { name: 'Waiting' }).click();
  await grid.getByRole('row').filter({ hasText: 'Policy confirmation' }).first().getByRole('gridcell').first().click();
  await expect(page.getByRole('heading', { name: 'Policy confirmation' })).toBeVisible();
  await expect(page.getByText('Insurance Contracts Act (2005:104) chapter 2 section 4', { exact: false })).toBeVisible();

  await page.getByRole('textbox', { name: "The document's id in the archive" }).fill('arch-2026-000123');
  await page.getByRole('textbox', { name: 'sha256' }).fill('a'.repeat(64));
  await page.getByRole('button', { name: 'Report' }).click();
  await expect(notice(page)).toContainText('Reported.');
  await expect(page.getByRole('grid', { name: 'Deliveries' }).getByRole('gridcell', { name: 'arch-2026-000123' })).toBeVisible();
});

test('a subscription is created with its secret shown once, turned off and on, and given a new secret', async ({ page }) => {
  await signIn(page, 'dev-integration');
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Webhooks' }).click();
  await page.getByRole('textbox', { name: 'Address' }).fill('http://crm.example.com/hook');
  await page.getByRole('textbox', { name: 'Events' }).fill('policy.*, claim.decided');
  await page.getByRole('textbox', { name: 'Markets' }).fill('SE');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('alert')).toContainText('Give an address that uses https.');

  await page.getByRole('textbox', { name: 'Address' }).fill('https://crm.example.com/hook');
  await page.getByRole('textbox', { name: 'Description' }).fill('CRM');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText('The secret is shown only now.')).toBeVisible();
  await expect(page.getByText(/^whsec_/)).toBeVisible();

  const grid = page.getByRole('grid', { name: 'Subscriptions' });
  await grid.getByRole('gridcell', { name: 'https://crm.example.com/hook' }).click();
  await expect(page.getByRole('heading', { name: 'CRM' })).toBeVisible();
  await page.getByRole('button', { name: 'Turn off' }).click();
  await expect(notice(page)).toContainText('Turned off.');
  await page.getByRole('button', { name: 'Turn on' }).click();
  await expect(notice(page).first()).toContainText('Turned on.');
  await page.getByRole('button', { name: 'New secret' }).click();
  await expect(page.getByText(/^whsec_/)).toBeVisible();
  await expect(page.getByText('The previous secret signs until')).toBeVisible();
});

test('the document system may have Petvold make a notice a PDF; without Gotenberg it says so (ADR 0038)', async ({ page }) => {
  await signIn(page, 'dev-documents');
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Notices' }).click();
  await page.getByRole('tab', { name: 'Waiting' }).click();
  const grid = page.getByRole('grid', { name: 'Notices' });
  await grid.getByRole('row').filter({ hasText: 'Claims decision' }).first().getByRole('gridcell').first().click();
  await expect(page.getByRole('heading', { name: 'PDF from Petvold' })).toBeVisible();
  await page.getByRole('button', { name: 'Make a PDF' }).click();
  // The flow tests run without Gotenberg: the answer names what is missing.
  await expect(page.getByRole('alert')).toContainText('PETVOLD_GOTENBERG_URL');
});
