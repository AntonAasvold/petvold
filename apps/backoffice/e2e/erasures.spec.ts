import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page, token: string) {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Token' }).click();
  await page.getByRole('option', { name: token, exact: true }).click();
  await page.getByRole('button', { name: 'Sign in' }).click();
}

// Erasure with four eyes (ADR 0028): one privacy officer asks, another approves.
test('a party is erased with four eyes: asked by one officer, approved by another', async ({ page }) => {
  // A party only this test uses.
  await signIn(page, 'dev-registrar');
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: /^Parties/ }).click();
  await page.getByRole('button', { name: 'Register a party' }).click();
  const form = page.locator('pv-party-register');
  await form.getByRole('textbox', { name: 'Given name' }).fill('Olle');
  await form.getByRole('textbox', { name: 'Family name' }).fill('Raderas');
  await form.getByRole('button', { name: 'Register the party' }).click();
  await expect(page).toHaveURL(/\/parties\/pty_/);
  const partyId = page.url().split('/').pop()!;
  await page.getByRole('button', { name: 'Sign out' }).click();

  await signIn(page, 'dev-privacy');
  const search = page.getByRole('searchbox', { name: 'Search for a claim, policy, animal or customer' });
  await search.fill(partyId);
  await search.press('Enter');
  await page.getByRole('textbox', { name: 'Reason, without personal data' }).fill('The person asked by letter');
  await page.getByRole('region', { name: 'Ask for erasure' }).getByRole('button', { name: 'Ask for erasure' }).click();
  await expect(page.getByRole('status')).toContainText('The request waits for another privacy officer.');

  await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: /^Erasure/ }).click();
  await page.getByRole('grid', { name: 'Erasure' }).getByRole('gridcell', { name: partyId }).click();
  await expect(page.getByText('Someone else must approve your request.')).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();

  await signIn(page, 'dev-privacy-2');
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: /^Erasure/ }).click();
  await page.getByRole('grid', { name: 'Erasure' }).getByRole('gridcell', { name: partyId }).click();
  await page.getByRole('button', { name: 'Anonymize the party' }).click();
  await expect(page.getByRole('status')).toContainText('The party is anonymized.');
  await page.getByRole('link', { name: partyId }).click();
  await expect(page.getByText('Anonymized')).toBeVisible();
});
