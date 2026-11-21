/** Labels for codes the API returns, in the current language. */
import { msg } from '@lit/localize';

export function claimStatusLabel(s: string): string {
  switch (s) {
    case 'awaiting-decision':
      return msg('Awaiting decision', { id: 'claims.status.awaiting-decision' });
    case 'awaiting-approval':
      return msg('Awaiting approval', { id: 'claims.status.awaiting-approval' });
    case 'awaiting-information':
      return msg('Awaiting information', { id: 'claims.status.awaiting-information' });
    case 'review-requested':
      return msg('Review requested', { id: 'claims.status.review-requested' });
    case 'decided':
      return msg('Decided', { id: 'claims.status.decided' });
    case 'withdrawn':
      return msg('Withdrawn', { id: 'claims.status.withdrawn' });
    case 'dismissed':
      return msg('Dismissed', { id: 'claims.status.dismissed' });
    default:
      return s;
  }
}

export function dismissalLabel(c: string): string {
  switch (c) {
    case 'duplicate':
      return msg('Duplicate of another claim', { id: 'close.duplicate' });
    case 'registered-in-error':
      return msg('Registered in error', { id: 'close.inError' });
    case 'not-a-claim':
      return msg('Not a claim', { id: 'close.notAClaim' });
    default:
      return c;
  }
}

export function statusVariant(s: string): 'brand' | 'success' | 'warning' | 'danger' | 'neutral' {
  return s === 'decided' ? 'success' : s === 'awaiting-approval' ? 'warning' : s === 'review-requested' ? 'danger' : s === 'withdrawn' || s === 'dismissed' ? 'neutral' : 'brand';
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
export function informationItemLabel(i: string): string {
  switch (i) {
    case 'itemised-invoice':
      return msg('Specified invoice', { id: 'info.item.itemised-invoice' });
    case 'medical-record':
      return msg('Medical record', { id: 'info.item.medical-record' });
    case 'referral':
      return msg('Referral', { id: 'info.item.referral' });
    case 'other':
      return msg('Other', { id: 'info.item.other' });
    default:
      return i;
  }
}

export function attachmentKindLabel(k: string): string {
  switch (k) {
    case 'invoice':
      return msg('Invoice', { id: 'register.invoice' });
    case 'medical-record':
      return msg('Medical record', { id: 'info.item.medical-record' });
    case 'referral':
      return msg('Referral', { id: 'info.item.referral' });
    case 'photo':
      return msg('Photo', { id: 'attachment.photo' });
    case 'other':
      return msg('Other', { id: 'info.item.other' });
    default:
      return k;
  }
}

export function correctionFieldLabel(f: string): string {
  switch (f) {
    case 'channel':
      return msg('Channel', { id: 'claims.col.channel' });
    case 'treatmentFrom':
      return msg('First day of treatment', { id: 'register.from' });
    case 'treatmentTo':
      return msg('Last day of treatment', { id: 'register.to' });
    case 'diagnosisCode':
      return msg('Diagnosis', { id: 'claims.col.diagnosis' });
    case 'lines':
      return msg('Invoice', { id: 'register.invoice' });
    default:
      return f;
  }
}

export function recipientLabel(r: string): string {
  return r === 'clinic' ? msg('The clinic', { id: 'info.recipient.clinic' }) : r === 'customer' ? msg('The customer', { id: 'info.recipient.customer' }) : r;
}

export function problemLabel(id: string): string {
  switch (id) {
    case 'product.badMarket':
      return msg('The market is two capital letters, e.g. SE.', { id: 'product.badMarket' });
    case 'product.badCurrency':
      return msg('The currency is three capital letters, e.g. SEK.', { id: 'product.badCurrency' });
    case 'product.needSpecies':
      return msg('Choose at least one species.', { id: 'product.needSpecies' });
    case 'product.needName':
      return msg('Give the product a name.', { id: 'product.needName' });
    case 'product.needRuleSeries':
      return msg('Give the claims rules series, e.g. SE-HUND-VV.', { id: 'product.needRuleSeries' });
    case 'product.priceTermsNeedTariff':
      return msg('Price terms need a tariff series.', { id: 'product.priceTermsNeedTariff' });
    case 'product.badLimits':
      return msg('Give the annual limits as amounts, separated by semicolons.', { id: 'product.badLimits' });
    case 'product.badDefaultLimit':
      return msg('The default annual limit must be one of the annual limits.', { id: 'product.badDefaultLimit' });
    case 'product.needDeductible':
      return msg('Add at least one deductible.', { id: 'product.needDeductible' });
    case 'product.badDeductible':
      return msg('Each deductible needs a code in small letters, a name, a fixed amount and a variable per cent.', { id: 'product.badDeductible' });
    case 'product.needPeriodDays':
      return msg('A deductible per period needs the length of the period.', { id: 'product.needPeriodDays' });
    case 'product.duplicateDeductible':
      return msg('Two deductibles have the same code.', { id: 'product.duplicateDeductible' });
    case 'product.badDefaultDeductible':
      return msg('Choose the default deductible.', { id: 'product.badDefaultDeductible' });
    case 'product.badWaiting':
      return msg('The waiting period is a number of days.', { id: 'product.badWaiting' });
    case 'product.badSetting':
      return msg('The policy settings are whole numbers.', { id: 'product.badSetting' });
    case 'rules.badGroups':
      return msg('Write the diagnosis groups one per line as code = group, each code once.', { id: 'rules.badGroups' });
    case 'rules.badAutoSettle':
      return msg('Give the amount settled automatically.', { id: 'rules.badAutoSettle' });
    case 'rules.badInformationDays':
      return msg('Give both days for requests for information, 1 to 365, or neither.', { id: 'rules.badInformationDays' });
    case 'policy.startTooFar':
      return msg('The start date is further ahead than the product allows.', { id: 'policy.startTooFar' });
    case 'document.needFile':
      return msg('Choose a file.', { id: 'document.needFile' });
    case 'document.badType':
      return msg('The file is a PDF, JPEG, PNG or HEIC.', { id: 'document.badType' });
    case 'document.tooLarge':
      return msg('The file is larger than 25 MB.', { id: 'document.tooLarge' });
    case 'document.empty':
      return msg('The file is empty.', { id: 'document.empty' });
    case 'attachment.badUrl':
      return msg('Give the address in the archive: https://… or urn:…', { id: 'attachment.badUrl' });
    case 'attachment.badSha':
      return msg('The checksum is 64 hex digits (sha256).', { id: 'attachment.badSha' });
    case 'attachment.badMediaType':
      return msg('The media type is e.g. application/pdf.', { id: 'attachment.badMediaType' });
    case 'attachment.badSize':
      return msg('The size is a number of bytes.', { id: 'attachment.badSize' });
    case 'info.needItems':
      return msg('Choose what is missing.', { id: 'info.needItems' });
    case 'info.needNote':
      return msg('Say what is missing.', { id: 'info.needNote' });
    case 'info.dueAfterToday':
      return msg('The due date is after today.', { id: 'info.dueAfterToday' });
    case 'decide.noOverride':
      return msg('You may not decide against the proposal (claims:override).', { id: 'decide.noOverride' });
    case 'decide.needCode':
      return msg('Choose a reason code.', { id: 'decide.needCode' });
    case 'close.needCode':
      return msg('Choose why the claim is dismissed.', { id: 'close.needCode' });
    case 'close.needDuplicate':
      return msg('Give the id of the claim it duplicates, e.g. clm_048213.', { id: 'close.needDuplicate' });
    case 'close.notItself':
      return msg('A claim cannot duplicate itself.', { id: 'close.notItself' });
    case 'decide.needReason':
      return msg('Write a reason.', { id: 'decide.needReason' });
    case 'policy.needAnimal':
      return msg('Give the animal as an animal id, e.g. ani_doris.', { id: 'policy.needAnimal' });
    case 'policy.needHolder':
      return msg('Give the policyholder as a party id, e.g. pty_owner002.', { id: 'policy.needHolder' });
    case 'policy.needProduct':
      return msg('Choose a product version.', { id: 'policy.needProduct' });
    case 'policy.needStart':
      return msg('Give the start date.', { id: 'policy.needStart' });
    case 'policy.needPremium':
      return msg('Give the premium as an amount, e.g. 3600.', { id: 'policy.needPremium' });
    case 'policy.needChannel':
      return msg('Give where the customer accepted.', { id: 'policy.needChannel' });
    case 'policy.badAcceptedAt':
      return msg('Give when the customer accepted. It cannot be in the future.', { id: 'policy.badAcceptedAt' });
    case 'policy.needDocuments':
      return msg('Tick that the customer was shown the terms and the pre-contract information.', { id: 'policy.needDocuments' });
    case 'erasure.needRestriction':
      return msg('Give the day the restriction lasts until, after today.', { id: 'erasure.needRestriction' });
    case 'group.needLitter':
      return msg('Give the litter as a litter id, e.g. lit_1.', { id: 'group.needLitter' });
    case 'group.needPolicy':
      return msg('Give the policy as a policy id, e.g. pol_bella.', { id: 'group.needPolicy' });
    case 'policy.needAnswers':
      return msg('Answer every health question.', { id: 'policy.needAnswers' });
    case 'policy.needDiagnoses':
      return msg('Give the diagnoses the customer declared.', { id: 'policy.needDiagnoses' });
    case 'policy.needCancelReason':
      return msg('Choose the reason for the cancellation.', { id: 'policy.needCancelReason' });
    case 'policy.futureReceived':
      return msg('The notice cannot have been received in the future.', { id: 'policy.futureReceived' });
    case 'policy.needEffective':
      return msg('Give the day the need ceased.', { id: 'policy.needEffective' });
    case 'policy.needNote':
      return msg('Write a note.', { id: 'policy.needNote' });
    case 'policy.changeFrom':
      return msg('The change applies from today or later.', { id: 'policy.changeFrom' });
    case 'animal.needSpecies':
      return msg('Choose the species.', { id: 'animal.needSpecies' });
    case 'animal.needSex':
      return msg('Choose the sex.', { id: 'animal.needSex' });
    case 'animal.needName':
      return msg("Give the animal's name.", { id: 'animal.needName' });
    case 'animal.needBirthDate':
      return msg('Give the date of birth.', { id: 'animal.needBirthDate' });
    case 'animal.futureBirth':
      return msg('The date of birth cannot be in the future.', { id: 'animal.futureBirth' });
    case 'animal.badChip':
      return msg('A microchip is 15 digits.', { id: 'animal.badChip' });
    case 'animal.needOwner':
      return msg('Give the owner as a party id, e.g. pty_owner001.', { id: 'animal.needOwner' });
    case 'animal.needOwnerFrom':
      return msg('Give the day the owner owns it from.', { id: 'animal.needOwnerFrom' });
    case 'animal.badDeath':
      return msg('The date of death is between the birth and today.', { id: 'animal.badDeath' });
    case 'animal.sameOwner':
      return msg('That party already owns the animal.', { id: 'animal.sameOwner' });
    case 'animal.transferBefore':
      return msg('The new owner must start after the current one did.', { id: 'animal.transferBefore' });
    case 'animal.needBreeder':
      return msg('Give the breeder as a party id.', { id: 'animal.needBreeder' });
    case 'animal.badParent':
      return msg('A parent is an animal id, e.g. ani_bella.', { id: 'animal.badParent' });
    case 'animal.litterSize':
      return msg('A litter has 1–24 animals.', { id: 'animal.litterSize' });
    case 'animal.litterAnimal':
      return msg('Each animal in the litter needs a name and a sex.', { id: 'animal.litterAnimal' });
    case 'party.needName':
      return msg('Give the given name and the family name.', { id: 'party.needName' });
    case 'party.needOrgName':
      return msg("Give the organization's name.", { id: 'party.needOrgName' });
    case 'party.badEmail':
      return msg('The email does not look like an email address.', { id: 'party.badEmail' });
    case 'party.badPhone':
      return msg('Give the phone in international format, e.g. +46701234567.', { id: 'party.badPhone' });
    case 'party.partAddress':
      return msg('Give the whole address: street, postal code and city.', { id: 'party.partAddress' });
    case 'party.badLanguage':
      return msg('The language is two small letters, e.g. sv.', { id: 'party.badLanguage' });
    case 'jobs.badTime':
      return msg('Give the time as HH:MM, e.g. 02:30.', { id: 'jobs.badTime' });
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
    case 'claim-decision':
      return msg('Claims decision', { id: 'notice.type.claim-decision' });
    case 'claim-information-request':
      return msg('Request for information', { id: 'notice.type.claim-information-request' });
    case 'claim-information-reminder':
      return msg('Reminder about information', { id: 'notice.type.claim-information-reminder' });
    case 'claim-information-expired':
      return msg('The information did not come in', { id: 'notice.type.claim-information-expired' });
    case 'invoice':
      return msg('Invoice', { id: 'notice.type.invoice' });
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

export function paymentIntervalLabel(i: string): string {
  switch (i) {
    case 'year':
      return msg('Yearly', { id: 'interval.year' });
    case 'half-year':
      return msg('Every six months', { id: 'interval.half-year' });
    case 'quarter':
      return msg('Quarterly', { id: 'interval.quarter' });
    case 'month':
      return msg('Monthly', { id: 'interval.month' });
    default:
      return i;
  }
}

export function jobLabel(name: string): string {
  switch (name) {
    case 'policies.application-expiry':
      return msg('Expiry of applications', { id: 'job.application-expiry' });
    case 'policies.proposal-expiry':
      return msg('Expiry of transfers', { id: 'job.proposal-expiry' });
    case 'policies.renewal':
      return msg('Renewal', { id: 'job.renewal' });
    case 'parties.retention':
      return msg('Retention', { id: 'job.retention' });
    case 'claims.information-requests':
      return msg('Reminders and expiry of requests for information', { id: 'job.information-requests' });
    case 'billing.invoicing':
      return msg('Invoicing', { id: 'job.invoicing' });
    default:
      return name;
  }
}

export function runStatusLabel(s: string): string {
  switch (s) {
    case 'running':
      return msg('Running', { id: 'run.running' });
    case 'succeeded':
      return msg('Done', { id: 'run.succeeded' });
    case 'failed':
      return msg('Failed', { id: 'run.failed' });
    case 'skipped':
      return msg('Skipped', { id: 'run.skipped' });
    default:
      return s;
  }
}

/** succeeded is done; failed stands out with a strong border; running waits; skipped is grey. */
export function runStatusVariant(s: string): 'success' | 'danger' | 'warning' | 'neutral' {
  return s === 'succeeded' ? 'success' : s === 'failed' ? 'danger' : s === 'running' ? 'warning' : 'neutral';
}

export function runTriggerLabel(t: string): string {
  switch (t) {
    case 'schedule':
      return msg('Schedule', { id: 'run.schedule' });
    case 'manual':
      return msg('Run now', { id: 'run.manual' });
    case 'api':
      return msg('API call', { id: 'run.api' });
    default:
      return t;
  }
}

export function scheduleLabel(s: { kind: string; at?: string; seconds?: number }): string {
  return s.kind === 'daily' ? `${msg('Daily at', { id: 'job.dailyAt' })} ${s.at}` : `${msg('Every', { id: 'job.every' })} ${s.seconds} s`;
}

export function identifierLabel(t: string): string {
  switch (t) {
    case 'microchip':
      return msg('Microchip', { id: 'animal.microchip' });
    case 'registration':
      return msg('Registration number', { id: 'animal.registration' });
    case 'passport':
      return msg('Passport', { id: 'animal.passport' });
    default:
      return t;
  }
}

/** How the customer accepted: the channel's name. */
export function channelLabelFor(c: string): string {
  switch (c) {
    case 'phone':
      return msg('Phone', { id: 'party.phone' });
    case 'paper':
      return msg('Paper', { id: 'policy.channelPaper' });
    case 'web':
      return msg('Web', { id: 'policy.channelWeb' });
    case 'app':
      return msg('App', { id: 'policy.channelApp' });
    default:
      return c;
  }
}

export function documentLabel(t: string): string {
  switch (t) {
    case 'terms':
      return msg('Terms', { id: 'policy.docTerms' });
    case 'pre-contract':
      return msg('Pre-contract information', { id: 'policy.docPreContract' });
    case 'ipid':
      return msg('Product fact sheet', { id: 'policy.docIpid' });
    default:
      return t;
  }
}

export function cancellationLabel(r: string): string {
  switch (r) {
    case 'customer-term-end':
      return msg('The customer, at the end of the term', { id: 'cancel.customer-term-end' });
    case 'customer-immediate':
      return msg('The customer, at once', { id: 'cancel.customer-immediate' });
    case 'withdrawal':
      return msg('Withdrawal within the cooling-off period', { id: 'cancel.withdrawal' });
    case 'need-ceased':
      return msg('The need ceased, e.g. the animal died', { id: 'cancel.need-ceased' });
    case 'insurer-term-end':
      return msg('The insurer, at the end of the term', { id: 'cancel.insurer-term-end' });
    case 'insurer-breach':
      return msg('The insurer, for a breach', { id: 'cancel.insurer-breach' });
    case 'unpaid-premium':
      return msg('Unpaid premium', { id: 'cancel.unpaid-premium' });
    default:
      return r;
  }
}

export function underwritingLabel(o: string): string {
  switch (o) {
    case 'accept':
      return msg('Accepted', { id: 'uw.accept' });
    case 'accept-with-riders':
      return msg('Accepted with riders', { id: 'uw.accept-with-riders' });
    case 'refer':
      return msg('Referred to an underwriter', { id: 'uw.refer' });
    case 'decline':
      return msg('Declined', { id: 'uw.decline' });
    default:
      return o;
  }
}

export function groupKindLabel(k: string): string {
  return k === 'litter' ? msg('Litter group', { id: 'group.litter' }) : k === 'household' ? msg('Household', { id: 'group.household' }) : k;
}

export function erasureBasisLabel(b: string): string {
  return b === 'subject-request' ? msg('The person asked', { id: 'erasure.subject' }) : b === 'retention-expired' ? msg('Retention ended', { id: 'erasure.retention' }) : b;
}

export function erasureOutcomeLabel(o: string): string {
  return o === 'approved' ? msg('Anonymized', { id: 'party.anonymized' }) : o === 'rejected' ? msg('Rejected', { id: 'jobs.rejectedBadge' }) : o;
}
