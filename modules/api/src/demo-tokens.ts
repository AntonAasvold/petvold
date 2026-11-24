/**
 * The fixed tokens of the dev server and the demo (ADR 0041). Anyone who reads
 * the repository knows them, so they are only for an installation in memory,
 * on a developer's machine, or behind the demo's password. server.ts uses them
 * only with PETVOLD_AUTH=demo.
 */
import type { Authenticator, Principal } from './app.ts';

/** The back office's roles for dev-all: not the jobs, and not the clinic or the customer channel, which bind the caller to their own claims or policies. */
export const ALL_ROLES = ['handler', 'approver', 'underwriter', 'policy-registrar', 'animal-registrar', 'party-registrar', 'privacy-officer', 'catalog-manager', 'catalog-publisher', 'rules-author', 'rules-publisher', 'communications-manager', 'integration-admin', 'operations', 'admin', 'document-service', 'billing-clerk'];

export const DEMO_TOKENS: Record<string, Principal> = {
  'dev-handler': { subject: 'handlaggare@example.test', roles: ['handler'], markets: '*' },
  'dev-approver': { subject: 'attestant@example.test', roles: ['approver'], markets: '*' },
  'dev-admin': { subject: 'admin@example.test', roles: ['admin'] },
  'dev-author': { subject: 'author@example.test', roles: ['rules-author'] },
  'dev-publisher': { subject: 'publisher@example.test', roles: ['rules-publisher'] },
  'dev-catalog': { subject: 'catalog@example.test', roles: ['catalog-manager'] },
  'dev-catalog-publisher': { subject: 'catalog-publisher@example.test', roles: ['catalog-publisher'] },
  'dev-registrar': { subject: 'registrar@example.test', roles: ['animal-registrar', 'party-registrar'], markets: ['SE'] },
  // Two privacy officers, since anonymization needs four eyes (ADR 0028).
  'dev-privacy': { subject: 'privacy-a@example.test', roles: ['privacy-officer'], markets: ['SE'] },
  'dev-privacy-2': { subject: 'privacy-b@example.test', roles: ['privacy-officer'], markets: ['SE'] },
  'dev-seller': { subject: 'seller@example.test', roles: ['policy-registrar'], markets: ['SE'] },
  'dev-underwriter': { subject: 'underwriter@example.test', roles: ['underwriter'], markets: ['SE'] },
  'dev-documents': { subject: 'document-service', roles: ['document-service'], markets: ['SE'] },
  'dev-communications': { subject: 'communications@example.test', roles: ['communications-manager'], markets: ['SE'] },
  'dev-billing': { subject: 'ekonomi@example.test', roles: ['billing-clerk'], markets: ['SE'] },
  'dev-accountant': { subject: 'redovisning@example.test', roles: ['accountant'], markets: ['SE'] },
  'dev-billing-manager': { subject: 'ekonomichef@example.test', roles: ['billing-manager'], markets: ['SE'] },
  'dev-integration': { subject: 'integration@example.test', roles: ['integration-admin'], markets: '*' },
  'dev-operations': { subject: 'drift@example.test', roles: ['operations'], markets: '*' },
  'dev-operations-2': { subject: 'drift2@example.test', roles: ['operations'], markets: '*' },
  'dev-renewal-job': { subject: 'renewal-job', roles: ['renewal-job'], markets: '*' },
  'dev-retention-job': { subject: 'retention-job', roles: ['retention-job'], markets: '*' },
  'dev-clinic': { subject: 'klinik-001', roles: ['clinic'], markets: ['SE'], clinicId: 'clinic_001' },
  'dev-job': { subject: 'reassessment-job', roles: ['reassessment-job'], markets: '*' },
  // Acts for the customer who owns Bella's policy in the sample data.
  'dev-customer': { subject: 'customer-portal', roles: ['customer-channel'], markets: ['SE'], policyIds: ['pol_bella'] },
  // Every role a person uses in the back office, for trying it all locally. Two
  // people, so that four eyes can be tried too. Never in DEFAULT_ROLES: no role
  // in an installation grants everything (ADR 0016).
  'dev-all': { subject: 'all-a@example.test', roles: ALL_ROLES, markets: '*' },
  'dev-all-2': { subject: 'all-b@example.test', roles: ALL_ROLES, markets: '*' },
};

/** Signs in with a token from DEMO_TOKENS, and with nothing else. */
export function demoAuthenticator(): Authenticator {
  // Own keys only: a token such as 'constructor' must not find Object's prototype.
  return { authenticate: async (t) => (t && Object.hasOwn(DEMO_TOKENS, t) ? DEMO_TOKENS[t]! : null) };
}
