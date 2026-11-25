import { expect, test, type Page } from '@playwright/test';

// The tests share one API server and run in order. Bella's claims share her annual limit, so the
// approval runs before any other of her claims is decided: otherwise its basis has changed, and the
// API answers 409, which the app shows as a conflict to reload.

/** Signs in with a dev token, in English. */
async function signIn(page: Page, token: string) {
  await page.goto('/');
  if (token !== 'dev-handler') {
    await page.getByRole('combobox', { name: 'Token' }).click();
    await page.getByRole('option', { name: token, exact: true }).click();
  }
  await page.getByRole('button', { name: 'Sign in' }).click();
  // The start page is the overview: to the claims queue.
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: /^Claims/ }).click();
  await expect(page.getByRole('heading', { name: 'Claims' })).toBeVisible();
}

/** The claim's history: the event log, newest first. */
const history = (page: Page) => page.getByRole('region', { name: 'History' });

async function openClaim(page: Page, claimNo: string, queue = 'All') {
  await page.getByRole('tab', { name: queue }).click();
  await page.getByRole('grid', { name: 'Claims' }).getByRole('gridcell', { name: claimNo }).click();
  await expect(page.getByRole('heading', { name: `Claim ${claimNo}` })).toBeVisible();
}

test('a decision against the proposal needs a reason code and a reason', async ({ page }) => {
  await signIn(page, 'dev-handler');
  await openClaim(page, 'S-2026-048213', 'Awaiting decision');
  const form = page.locator('pv-claim-actions');
  const proposed = (await page.getByText('Proposal:').textContent()) ?? '';
  // Why the claim needs a person: the rule that sent it here, said by name.
  await expect(form.getByText('Why a claims handler')).toBeVisible();
  await expect(form.getByRole('listitem').first()).toContainText('The rule RIDER asks for a claims handler to review');
  // Choose the action the proposal does not suggest.
  await form.getByRole('radio', { name: proposed.includes('Rejected') ? /^Approve payout/ : /^Reject/ }).click();
  await expect(form.getByText('This goes against the proposal.')).toBeVisible();
  await form.getByRole('button', { name: /^(Approve payout|Reject the claim)/ }).click();
  await expect(form.getByRole('alert')).toContainText('Choose a reason code.');
  await expect(form.getByRole('alert')).toContainText('Write a reason.');
});

test('a proposal above the limit: the handler cannot approve it, another person can (four eyes)', async ({ page }) => {
  // The sample data's handler proposed a payout above their limit.
  await signIn(page, 'dev-handler');
  await openClaim(page, 'S-2026-050977', 'Awaiting approval');
  await expect(page.locator('pv-claim-actions').getByText('Someone else must approve your proposal.')).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();

  await signIn(page, 'dev-approver');
  await openClaim(page, 'S-2026-050977', 'Awaiting approval');
  await page.locator('pv-claim-actions').getByRole('button', { name: 'Approve' }).click();
  await expect(page.locator('pv-claim-actions').getByRole('status')).toContainText('Approved.');
  await expect(history(page).getByText('Decision #1', { exact: true })).toBeVisible();
});

test('a handler decides within the limit, and the claim is decided', async ({ page }) => {
  await signIn(page, 'dev-handler');
  await openClaim(page, 'S-2026-048213', 'Awaiting decision');
  // The button says what happens, with the amount.
  await page.locator('pv-claim-actions').getByRole('button', { name: /^Approve payout · SEK [\d,]+\.\d\d$/ }).click();
  await expect(page.locator('pv-claim-actions').getByRole('status')).toContainText('The claim is decided.');
  await expect(history(page).getByText('Decision #1', { exact: true })).toBeVisible();
});

test("a requested review is answered by a person's decision", async ({ page }) => {
  await signIn(page, 'dev-handler');
  await openClaim(page, 'S-2026-033410', 'Review requested');
  const form = page.locator('pv-claim-actions');
  await expect(form.getByRole('heading', { name: 'Review the decision' })).toBeVisible();
  if (await form.getByRole('button', { name: 'Reject the claim' }).isVisible()) {
    // A rejection always needs a reason, also when it follows the proposal.
    await form.getByRole('button', { name: 'Reject the claim' }).click();
    await expect(form.getByRole('alert')).toContainText('Write a reason.');
    await form.getByRole('textbox', { name: 'Reason' }).fill('Within the waiting period.');
    await form.getByRole('button', { name: 'Reject the claim' }).click();
  } else {
    await form.getByRole('button', { name: /^Approve payout/ }).click();
  }
  await expect(page.locator('pv-claim-actions').getByRole('status')).toContainText('The claim is decided.');
  await expect(page.locator('pv-claim-actions').getByRole('heading', { name: 'Review requested' })).toHaveCount(0);
});

test('the explanation shows why a decision came out as it did', async ({ page }) => {
  await signIn(page, 'dev-handler');
  await openClaim(page, 'S-2026-021877', 'Decided');
  // The history is newest first, on the inverted panel, with the event names the API uses.
  const items = history(page).getByRole('listitem');
  await expect(items.last()).toContainText('claim.received');
  // The claims decision notice to the customer may come after the decision (ADR 0036).
  await expect(items.filter({ hasText: 'claim.decided' }).first()).toBeVisible();
  await history(page).getByRole('button', { name: /^Why\? #/ }).first().click();
  await expect(page.getByRole('dialog', { name: 'Why this decision' })).toBeVisible();
  // The content is slotted into Web Awesome's dialog, so it is looked for on the page.
  await expect(page.getByRole('heading', { name: 'The calculation' })).toBeVisible();
  await expect(page.locator('pv-explanation-dialog').getByRole('listitem').filter({ hasText: 'Fixed deductible' })).toBeVisible();
});

test('the calculation is a waterfall: billed, each deduction with its rule, and the payout', async ({ page }) => {
  await signIn(page, 'dev-handler');
  await openClaim(page, 'S-2026-021877', 'Decided');
  const wf = page.getByRole('list', { name: 'Calculation' });
  await expect(wf.getByRole('listitem').first()).toContainText('Billed');
  await expect(wf.getByRole('listitem').last()).toContainText('Payout');
  await expect(wf.getByRole('listitem').filter({ has: page.getByText('Fixed deductible', { exact: true }) })).toContainText('− SEK');
});
