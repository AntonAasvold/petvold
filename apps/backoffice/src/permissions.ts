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
  anyOf: string[];
}

export const SECTIONS: Section[] = [
  { path: '/claims', label: 'nav.claims', icon: 'file-invoice', anyOf: ['claims:read'] },
  { path: '/policies', label: 'nav.policies', icon: 'paw', anyOf: ['policies:read'] },
  { path: '/applications', label: 'nav.applications', icon: 'list-check', anyOf: ['policies:read'] },
  { path: '/proposals', label: 'nav.proposals', icon: 'user-check', anyOf: ['policies:read'] },
  { path: '/notices', label: 'nav.notices', icon: 'envelope', anyOf: ['notices:read'] },
  { path: '/webhooks', label: 'nav.webhooks', icon: 'plug', anyOf: ['webhooks:read'] },
  { path: '/settings', label: 'nav.settings', icon: 'gear', anyOf: ['access:read', 'parties:privacy', 'notices:read'] },
];

export const can = (me: Me | null, permission: string): boolean => !!me?.permissions.includes(permission);

/** The sections the caller sees, in order. */
export const sectionsFor = (me: Me | null): Section[] => SECTIONS.filter((s) => s.anyOf.some((p) => can(me, p)));
