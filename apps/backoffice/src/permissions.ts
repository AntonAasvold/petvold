/** What the caller may do, from GET /v1/me. The API decides every call; this only hides what would be refused. */
export interface Me {
  subject: string;
  roles: string[];
  permissions: string[];
  scope: { markets: '*' | string[]; clinicId?: string; policyIds?: string[] };
}

/** A section of the back office, shown when the caller has one of its permissions. */
export interface Section {
  path: string;
  /** Message id of the label. */
  label: string;
  /** A Font Awesome icon in icons.json. */
  icon: string;
  /** The permissions that show it. Empty: everyone signed in. */
  anyOf: string[];
  /** The queue whose waiting items the menu counts, as a list call with its filter. */
  count?: { path: CountPath; query: Record<string, string | boolean> };
}

export type CountPath = '/v1/claims' | '/v1/applications' | '/v1/policy-proposals' | '/v1/notices' | '/v1/webhook-deliveries' | '/v1/relay-dead-letters' | '/v1/erasure-requests' | '/v1/received-payments';

/** How many wait, from one page of a list: the number, or "100+" when there are more pages. */
export function countLabel(page: { items: unknown[]; nextCursor?: string }): string {
  return page.nextCursor ? `${page.items.length}+` : String(page.items.length);
}

export const SECTIONS: Section[] = [
  { path: '/claims', label: 'nav.claims', icon: 'file-invoice', anyOf: ['claims:read'], count: { path: '/v1/claims', query: { status: 'awaiting-decision' } } },
  { path: '/policies', label: 'nav.policies', icon: 'paw', anyOf: ['policies:read'] },
  { path: '/parties', label: 'nav.parties', icon: 'address-book', anyOf: ['parties:read'] },
  { path: '/animals', label: 'nav.animals', icon: 'dog', anyOf: ['animals:read'] },
  { path: '/erasures', label: 'nav.erasures', icon: 'user-slash', anyOf: ['parties:privacy'], count: { path: '/v1/erasure-requests', query: { status: 'pending' } } },
  { path: '/applications', label: 'nav.applications', icon: 'list-check', anyOf: ['policies:read'], count: { path: '/v1/applications', query: { status: 'referred' } } },
  { path: '/proposals', label: 'nav.proposals', icon: 'user-check', anyOf: ['policies:read'], count: { path: '/v1/policy-proposals', query: { status: 'pending' } } },
  { path: '/notices', label: 'nav.notices', icon: 'envelope', anyOf: ['notices:read'], count: { path: '/v1/notices', query: { attention: true } } },
  { path: '/money', label: 'nav.money', icon: 'coins', anyOf: ['billing:read', 'payments:read'], count: { path: '/v1/received-payments', query: { status: 'unmatched' } } },
  { path: '/webhooks', label: 'nav.webhooks', icon: 'plug', anyOf: ['webhooks:read'], count: { path: '/v1/webhook-deliveries', query: { status: 'dead' } } },
  { path: '/jobs', label: 'nav.jobs', icon: 'clock', anyOf: ['jobs:read'], count: { path: '/v1/relay-dead-letters', query: {} } },
  { path: '/products', label: 'nav.products', icon: 'box', anyOf: ['catalog:read'] },
  { path: '/rule-sets', label: 'nav.ruleSets', icon: 'scale-balanced', anyOf: ['rules:read'] },
  { path: '/settings', label: 'nav.settings', icon: 'gear', anyOf: ['access:read', 'parties:privacy', 'notices:read'] },
  { path: '/docs', label: 'nav.docs', icon: 'book', anyOf: [] },
];

export const can = (me: Me | null, permission: string): boolean => !!me?.permissions.includes(permission);

/** The sections the caller sees, in order. */
export const sectionsFor = (me: Me | null): Section[] => SECTIONS.filter((s) => (s.anyOf.length === 0 ? !!me : s.anyOf.some((p) => can(me, p))));
