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
    case 'application.needNote':
      return msg('Write the grounds for the decision.', { id: 'application.needNote' });
    case 'application.needReason':
      return msg('Give a reason code in lowercase, e.g. ongoing-symptoms.', { id: 'application.needReason' });
    case 'application.startInPast':
      return msg('The start date cannot be in the past.', { id: 'application.startInPast' });
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
