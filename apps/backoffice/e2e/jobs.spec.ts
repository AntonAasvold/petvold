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
  await page.getByRole('region', { name: /^(Pause|Resume)$/ }).getByRole('textbox', { name: 'Reason' }).fill('Checking the renewal rules for NO');
  await page.getByRole('button', { name: 'Pause the run' }).click();
  await expect(page.locator('pv-job-detail').getByRole('status').filter({ hasText: 'The run' })).toContainText('The run is paused.');
  const trail = page.getByRole('region', { name: 'Changes' });
  await expect(trail.getByRole('listitem').first()).toContainText('Checking the renewal rules for NO');

  await page.getByRole('region', { name: /^(Pause|Resume)$/ }).getByRole('textbox', { name: 'Reason' }).fill('Rules are right');
  await page.getByRole('button', { name: 'Resume the run' }).click();
  await expect(page.locator('pv-job-detail').getByRole('status').filter({ hasText: 'The run' })).toContainText('The run is resumed.');
  await expect(trail.getByRole('listitem')).toHaveCount(2);
});

test('a schedule change is proposed by one and approved by another (four eyes)', async ({ page }) => {
  const signIn = async (token: string) => {
    await page.goto('/');
    await page.getByRole('combobox', { name: 'Token' }).click();
    await page.getByRole('option', { name: token, exact: true }).click();
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: /^Runs/ }).click();
    await page.getByRole('grid', { name: 'Runs' }).getByRole('gridcell', { name: 'Retention' }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: 'Retention' })).toBeVisible();
  };
  await signIn('dev-operations');
  const card = page.getByRole('region', { name: 'Schedule' });
  await card.getByLabel('Time in each market').fill('04:30');
  await card.getByRole('textbox', { name: 'Reason' }).fill('After the night backup');
  await card.getByRole('button', { name: 'Propose the change' }).click();
  await expect(card).toContainText('Waiting for approval');
  await expect(card).toContainText('Someone else must approve your change.');
  await expect(card.getByRole('button', { name: 'Approve the change' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Sign out' }).click();
  await signIn('dev-operations-2');
  await page.getByRole('region', { name: 'Schedule' }).getByRole('button', { name: 'Approve the change' }).click();
  await expect(page.locator('pv-job-detail').getByRole('status').filter({ hasText: 'Approved' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Schedule' })).toContainText('Daily at 04:30');
  await expect(page.getByRole('region', { name: 'Changes' }).getByRole('listitem').first()).toContainText('drift@example.test → drift2@example.test');
});

test("the queues: what waits for the relay in each module, and the webhooks to the insurer's systems", async ({ page }) => {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Token' }).click();
  await page.getByRole('option', { name: 'dev-all', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: /^Runs/ }).click();
  const queues = page.getByRole('grid', { name: 'Queues' });
  await expect(queues.getByRole('row').filter({ hasText: 'claims' })).toBeVisible();
  await expect(queues.getByRole('row').filter({ hasText: 'billing' })).toBeVisible();
  await expect(queues.getByRole('row').filter({ hasText: 'webhooks' })).toBeVisible();
});
