import { expect, test } from '@playwright/test';

// Operations watches and steers the daily runs (ADR 0037).
test('operations sees the runs, tries one now, and pauses and resumes it with a reason', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Token' }).click();
  await page.getByRole('option', { name: 'dev-operations', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: /^Runs/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Runs' })).toBeVisible();

  const grid = page.getByRole('grid', { name: 'Runs' });
  await expect(grid.getByRole('row').filter({ hasText: 'Renewal' }).first()).toContainText('Daily at 02:00');
  await expect(page.getByText('No dead letters.')).toBeVisible();
  await grid.getByRole('gridcell', { name: 'Renewal' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Renewal' })).toBeVisible();

  // A dry run stores nothing, and it shows in the history.
  await page.getByRole('button', { name: /^Try the run · SE$/ }).click();
  await expect(page.locator('pv-job-detail').getByRole('status').filter({ hasText: 'The run' })).toContainText('The run is done.');
  const history = page.getByRole('grid', { name: 'History' });
  await expect(history.getByRole('row').nth(1)).toContainText('Run now (dry run)');
  await expect(history.getByRole('row').nth(1)).toContainText('drift@example.test');
  await expect(history.getByRole('row').nth(1)).toContainText('Done');

  // A pause needs a reason, takes effect at once, and is in the trail.
  await page.getByRole('button', { name: 'Pause the run' }).click();
  await expect(page.getByRole('alert')).toContainText('Give a reason for the change.');
  await page.getByRole('textbox', { name: 'Reason' }).fill('Checking the renewal rules for NO');
  await page.getByRole('button', { name: 'Pause the run' }).click();
  await expect(page.locator('pv-job-detail').getByRole('status').filter({ hasText: 'The run' })).toContainText('The run is paused.');
  const trail = page.getByRole('region', { name: 'Paused and resumed' });
  await expect(trail.getByRole('listitem').first()).toContainText('Checking the renewal rules for NO');

  await page.getByRole('textbox', { name: 'Reason' }).fill('Rules are right');
  await page.getByRole('button', { name: 'Resume the run' }).click();
  await expect(page.locator('pv-job-detail').getByRole('status').filter({ hasText: 'The run' })).toContainText('The run is resumed.');
  await expect(trail.getByRole('listitem')).toHaveCount(2);
});
