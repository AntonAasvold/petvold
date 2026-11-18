/** Labels for codes the API returns, in the current language. */
import { msg } from '@lit/localize';

export function claimStatusLabel(s: string): string {
  switch (s) {
    case 'awaiting-decision':
      return msg('Awaiting decision', { id: 'claims.status.awaiting-decision' });
    case 'awaiting-approval':
      return msg('Awaiting approval', { id: 'claims.status.awaiting-approval' });
    case 'review-requested':
      return msg('Review requested', { id: 'claims.status.review-requested' });
    case 'decided':
      return msg('Decided', { id: 'claims.status.decided' });
    default:
      return s;
  }
}

export function statusVariant(s: string): 'brand' | 'success' | 'warning' | 'danger' | 'neutral' {
  return s === 'decided' ? 'success' : s === 'awaiting-approval' ? 'warning' : s === 'review-requested' ? 'danger' : 'brand';
}

export function outcomeLabel(o: string): string {
  switch (o) {
    case 'approved':
      return msg('Approved', { id: 'outcome.approved' });
    case 'partial':
      return msg('Partly approved', { id: 'outcome.partial' });
    case 'rejected':
      return msg('Rejected', { id: 'outcome.rejected' });
    default:
      return o;
  }
}

export function ruleStatusLabel(s: string): string {
  switch (s) {
    case 'pass':
      return msg('Pass', { id: 'result.pass' });
    case 'fail':
      return msg('Fail', { id: 'result.fail' });
    case 'review':
      return msg('Review', { id: 'result.review' });
    case 'info':
      return msg('Info', { id: 'result.info' });
    default:
      return s;
  }
}

export function channelLabel(c: string): string {
  return c === 'clinic_direct' ? msg('Clinic', { id: 'claims.channel.clinic_direct' }) : msg('Customer', { id: 'claims.channel.customer' });
}

export function deviationLabel(c: string): string {
  switch (c) {
    case 'pre_existing_condition':
      return msg('Condition before the policy', { id: 'deviation.pre_existing_condition' });
    case 'not_covered':
      return msg('Not covered', { id: 'deviation.not_covered' });
    case 'insufficient_documentation':
      return msg('Insufficient documentation', { id: 'deviation.insufficient_documentation' });
    case 'incorrect_invoice':
      return msg('Incorrect invoice', { id: 'deviation.incorrect_invoice' });
    case 'other':
      return msg('Other', { id: 'deviation.other' });
    default:
      return c;
  }
}

/** The texts for what stops a decision (decide.ts). */
export function problemLabel(id: string): string {
  switch (id) {
    case 'decide.noOverride':
      return msg('You may not decide against the proposal (claims:override).', { id: 'decide.noOverride' });
    case 'decide.needCode':
      return msg('Choose a reason code.', { id: 'decide.needCode' });
    case 'decide.needReason':
      return msg('Write a reason.', { id: 'decide.needReason' });
    case 'register.needPolicy':
      return msg('Fetch the policy first.', { id: 'register.needPolicy' });
    case 'register.needDates':
      return msg('Give the first and last day of treatment.', { id: 'register.needDates' });
    case 'register.datesOrder':
      return msg('The last day of treatment is before the first.', { id: 'register.datesOrder' });
    case 'register.future':
      return msg('The treatment cannot start in the future.', { id: 'register.future' });
    case 'register.needDiagnosis':
      return msg('Give a diagnosis code.', { id: 'register.needDiagnosis' });
    case 'register.needLine':
      return msg('Add at least one invoice line.', { id: 'register.needLine' });
    case 'register.badLine':
      return msg('Each line needs a description and an amount; VAT cannot be more than the amount.', { id: 'register.badLine' });
    case 'application.needNote':
      return msg('Write the grounds for the decision.', { id: 'application.needNote' });
    case 'application.needReason':
      return msg('Give a reason code in lowercase, e.g. ongoing-symptoms.', { id: 'application.needReason' });
    case 'application.startInPast':
      return msg('The start date cannot be in the past.', { id: 'application.startInPast' });
    case 'settings.badMarket':
      return msg('A market is two capital letters, e.g. SE.', { id: 'settings.badMarket' });
    case 'settings.badYears':
      return msg('Years are whole numbers, 1-100.', { id: 'settings.badYears' });
    case 'settings.repeatedMarket':
      return msg('A market is listed twice.', { id: 'settings.repeatedMarket' });
    case 'settings.needReason':
      return msg('Give a reason for the change.', { id: 'settings.needReason' });
    case 'settings.badPromptly':
      return msg('Days are a whole number, 1-30.', { id: 'settings.badPromptly' });
    case 'settings.badAmount':
      return msg('Give the amount as a number, e.g. 25000.', { id: 'settings.badAmount' });
    case 'webhooks.needHttps':
      return msg('Give an address that uses https.', { id: 'webhooks.needHttps' });
    case 'webhooks.needTypes':
      return msg('Give event types, e.g. policy.* or claim.decided.', { id: 'webhooks.needTypes' });
    case 'webhooks.needMarkets':
      return msg('Give markets, e.g. SE, or *.', { id: 'webhooks.needMarkets' });
    default:
      return id;
  }
}

export function policyStatusLabel(s: string): string {
  return s === 'active' ? msg('Active', { id: 'policy.status.active' }) : msg('Ended', { id: 'policy.status.cancelled' });
}

export function proposalKindLabel(k: string): string {
  return k === 'transfer' ? msg('Transfer to a new owner', { id: 'proposal.kind.transfer' }) : msg('Ends: the animal died', { id: 'proposal.kind.cancel-death' });
}

export function transactionLabel(t: string): string {
  switch (t) {
    case 'issue':
      return msg('Issued', { id: 'tx.issue' });
    case 'cancel':
      return msg('Cancelled', { id: 'tx.cancel' });
    case 'reinstate':
      return msg('Reinstated', { id: 'tx.reinstate' });
    case 'renew':
      return msg('Renewed', { id: 'tx.renew' });
    case 'transfer':
      return msg('Transferred', { id: 'tx.transfer' });
    case 'change':
      return msg('Changed', { id: 'tx.change' });
    default:
      return t;
  }
}

export function applicationStatusLabel(s: string): string {
  switch (s) {
    case 'accepted':
      return msg('Accepted', { id: 'application.status.accepted' });
    case 'referred':
      return msg('Waits for a person', { id: 'application.status.referred' });
    case 'declined':
      return msg('Declined', { id: 'application.status.declined' });
    case 'withdrawn':
      return msg('Withdrawn', { id: 'application.status.withdrawn' });
    case 'expired':
      return msg('Expired', { id: 'application.status.expired' });
    default:
      return s;
  }
}

export function noticeTypeLabel(t: string): string {
  switch (t) {
    case 'policy-confirmation':
      return msg('Policy confirmation', { id: 'notice.type.policy-confirmation' });
    case 'renewal-notice':
      return msg('Renewal notice', { id: 'notice.type.renewal-notice' });
    case 'insurer-termination':
      return msg("The insurer's termination", { id: 'notice.type.insurer-termination' });
    case 'cancellation-confirmation':
      return msg('Cancellation confirmed', { id: 'notice.type.cancellation-confirmation' });
    case 'application-declined':
      return msg('Application declined', { id: 'notice.type.application-declined' });
    case 'transfer-offer':
      return msg('Offer to a new owner', { id: 'notice.type.transfer-offer' });
    default:
      return t;
  }
}

export function noticeStatusLabel(s: string): string {
  return s === 'sent' ? msg('Sent', { id: 'notices.tab.sent' }) : s === 'failed' ? msg('Failed', { id: 'notice.failed' }) : msg('Waiting', { id: 'notices.tab.pending' });
}

export function noticeFlagLabel(f: string): string {
  switch (f) {
    case 'failed':
      return msg('Failed', { id: 'notice.failed' });
    case 'overdue':
      return msg('Overdue', { id: 'notice.overdue' });
    case 'incomplete':
      return msg('Text missing', { id: 'notice.incomplete' });
    case 'late':
      return msg('Sent late', { id: 'notices.tab.late' });
    default:
      return f;
  }
}

export function lineCategoryLabel(c: string): string {
  switch (c) {
    case 'examination':
      return msg('Examination', { id: 'line.examination' });
    case 'diagnostics':
      return msg('Diagnostics', { id: 'line.diagnostics' });
    case 'medication':
      return msg('Medication', { id: 'line.medication' });
    case 'surgery':
      return msg('Surgery', { id: 'line.surgery' });
    case 'anaesthesia':
      return msg('Anaesthesia', { id: 'line.anaesthesia' });
    case 'hospitalisation':
      return msg('Hospitalisation', { id: 'line.hospitalisation' });
    case 'food':
      return msg('Food', { id: 'line.food' });
    default:
      return c;
  }
}
