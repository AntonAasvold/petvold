import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page, token: string, section: string) {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Token' }).click();
  await page.getByRole('option', { name: token, exact: true }).click();
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('link', { name: section }).click();
}

const status = (page: Page) => page.locator('pv-versions-panel').locator('wa-callout[role="status"]');
const nextYear = new Date().getFullYear() + 1;

test('a product version: draft, review and publication with four eyes', async ({ page }) => {
  await signIn(page, 'dev-catalog', 'Products');
  await page.getByRole('grid', { name: 'Products' }).getByRole('gridcell', { name: 'SE-HUND-BAS', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Product SE-HUND-BAS' })).toBeVisible();
  await page.getByRole('button', { name: 'New draft from this' }).click();
  const version = await page.getByRole('textbox', { name: 'Version' }).inputValue();
  expect(version).toMatch(/^\d{4}\.\d+$/);
  await page.getByLabel('Sales from').fill(`${nextYear}-01-01`);
  // The content is a form: a mistake is shown before anything is sent, and JSON is a click away.
  const content = page.locator('pv-product-content');
  await content.getByRole('textbox', { name: 'Annual limits' }).fill('30 000; lots');
  await page.getByRole('button', { name: 'Save the draft' }).click();
  await expect(page.locator('pv-versions-panel').getByRole('alert')).toContainText('Give the annual limits as amounts');
  await content.getByRole('textbox', { name: 'Annual limits' }).fill('30 000; 60 000');
  await content.getByRole('spinbutton', { name: 'Waiting period, days' }).fill('45');
  await content.getByRole('spinbutton', { name: 'Start at most, days ahead' }).fill('60');
  await page.getByRole('button', { name: 'JSON' }).click();
  await expect(page.getByRole('textbox', { name: 'Content (JSON)' })).toHaveValue(/"maxStartAheadDays": 60/);
  await page.getByRole('button', { name: 'Form' }).click();
  await page.getByRole('button', { name: 'Save the draft' }).click();
  await expect(status(page)).toContainText('Done.');
  const versions = page.getByRole('grid', { name: 'Versions' });
  await versions.getByRole('gridcell', { name: version, exact: true }).click();
  await expect(page.locator('pv-versions-panel').getByRole('region', { name: 'Content' })).toContainText('45');
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(status(page)).toContainText('Done.');
  await expect(page.getByText('Someone else must publish what you submitted.')).toBeVisible();

  // The publisher ends the sales of the version on sale, then publishes the new one.
  await page.getByRole('button', { name: 'Sign out' }).click();
  await signIn(page, 'dev-catalog-publisher', 'Products');
  await page.getByRole('grid', { name: 'Products' }).getByRole('gridcell', { name: 'SE-HUND-BAS', exact: true }).click();
  await versions.getByRole('gridcell', { name: '2026.1', exact: true }).click();
  await page.getByRole('textbox', { name: 'Reason' }).fill(`Replaced by ${version}`);
  await page.getByLabel('Last day of sales is the day before').fill(`${nextYear}-01-01`);
  await page.getByRole('button', { name: 'End sales' }).click();
  await expect(status(page)).toContainText('Done.');
  await versions.getByRole('gridcell', { name: version, exact: true }).click();
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(status(page)).toContainText('Done.');
  await expect(versions.getByRole('row').filter({ has: page.getByRole('gridcell', { name: version, exact: true }) })).toContainText('Published');
});

test('a rule set version: a new draft is submitted and published by someone else', async ({ page }) => {
  await signIn(page, 'dev-author', 'Rule sets');
  await page.getByRole('grid', { name: 'Rule sets' }).getByRole('gridcell', { name: 'SE-HUND-VV', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Rule set SE-HUND-VV' })).toBeVisible();
  await page.getByRole('button', { name: 'New draft from this' }).click();
  await page.getByLabel('In force from').fill(`${nextYear}-01-01`);
  const rules = page.locator('pv-rules-content');
  await rules.getByRole('spinbutton', { name: 'Reminder after, days' }).fill('10');
  await page.getByRole('button', { name: 'Save the draft' }).click();
  await expect(page.locator('pv-versions-panel').getByRole('alert')).toContainText('Give both days for requests for information');
  await rules.getByRole('spinbutton', { name: 'Due after, days' }).fill('21');
  await page.getByRole('button', { name: 'Save the draft' }).click();
  await expect(status(page)).toContainText('Done.');
  const versions = page.getByRole('grid', { name: 'Versions' });
  const draft = versions.getByRole('row').filter({ hasText: 'Draft' });
  await draft.getByRole('gridcell').first().click();
  await expect(page.locator('pv-versions-panel').locator('pre')).toContainText('"expiresAfterDays": 21');
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(status(page)).toContainText('Done.');

  await page.getByRole('button', { name: 'Sign out' }).click();
  await signIn(page, 'dev-publisher', 'Rule sets');
  await page.getByRole('grid', { name: 'Rule sets' }).getByRole('gridcell', { name: 'SE-HUND-VV', exact: true }).click();
  await versions.getByRole('row').filter({ hasText: 'In review' }).getByRole('gridcell').first().click();
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(status(page)).toContainText('Done.');
  await expect(versions.getByRole('row').filter({ hasText: 'In review' })).toHaveCount(0);
});

test('a tariff and price terms are edited as forms', async ({ page }) => {
  await signIn(page, 'dev-author', 'Rule sets');
  const versions = page.getByRole('grid', { name: 'Versions' });
  const panel = page.locator('pv-versions-panel');

  await page.getByRole('grid', { name: 'Rule sets' }).getByRole('gridcell', { name: 'SE-HUND-TARIFF', exact: true }).click();
  await page.getByRole('button', { name: 'New draft from this' }).click();
  await page.getByLabel('In force from').fill(`${nextYear}-01-01`);
  const tariff = page.locator('pv-tariff-content');
  await expect(tariff.getByRole('textbox', { name: 'Base premiums a year' })).toHaveValue('dog; 30000; 2400\ndog; 60000; 3000');
  await tariff.getByRole('textbox', { name: 'Zone of other postal codes' }).fill('suburb');
  await page.getByRole('button', { name: 'Save the draft' }).click();
  await expect(panel.getByRole('alert')).toContainText('Every zone, also the one for other postal codes, needs a factor.');
  await tariff.getByRole('textbox', { name: 'Factor per zone' }).fill('city = 1.15\ncentre = 1.2\nrural = 0.95\nsuburb = 1,05');
  await page.getByRole('button', { name: 'Save the draft' }).click();
  await expect(status(page)).toContainText('Done.');
  await versions.getByRole('row').filter({ hasText: 'Draft' }).getByRole('gridcell').first().click();
  await expect(panel.locator('pre')).toContainText('"suburb": 10500');

  await page.getByRole('link', { name: 'Rule sets' }).first().click();
  await page.getByRole('grid', { name: 'Rule sets' }).getByRole('gridcell', { name: 'SE-HUND-TERMS', exact: true }).click();
  await page.getByRole('button', { name: 'New draft from this' }).click();
  await page.getByLabel('In force from').fill(`${nextYear}-01-01`);
  const terms = page.locator('pv-price-terms-content');
  await terms.getByRole('textbox', { name: 'Campaign codes' }).fill('PUPPY2026; 2026-01-01; 2027-01-01; 20; new\nSPRING; 2027-03-01; ; 5; all');
  await page.getByRole('button', { name: 'Save the draft' }).click();
  await expect(status(page)).toContainText('Done.');
  await versions.getByRole('row').filter({ hasText: 'Draft' }).getByRole('gridcell').first().click();
  await expect(panel.locator('pre')).toContainText('"code": "SPRING"');
});
