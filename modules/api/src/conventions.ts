/**
 * The contract's naming conventions (ADR 0034), checked in CI by lint:openapi.
 * Pure: takes the parsed contract and returns what breaks a rule.
 */

type Param = { name: string; in: string; schema?: { pattern?: string } };
type Operation = { operationId?: string; tags?: string[]; parameters?: (Param | { $ref: string })[] };
export interface ContractLike {
  paths: Record<string, Record<string, unknown>>;
  components?: { parameters?: Record<string, Param> };
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];
/** A literal path segment: lowercase words joined by hyphens. */
const SEGMENT = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const CAMEL = /^[a-z][a-zA-Z0-9]*$/;
/** Path parameters that are natural keys, not ids. */
export const NATURAL_KEYS = ['product', 'version', 'series', 'kind', 'code', 'seq'];
/** The roles a party has in a filter: `{role}PartyId`. */
export const PARTY_ROLES = ['owner', 'policyholder', 'recipient'];
/** Words that read badly as a resource; the replacement in parentheses. */
const BANNED_SEGMENTS: Record<string, string> = { ends: 'endings', 'sales-ends': 'sales-endings', lookup: 'a collection such as summaries' };

export interface ConventionProblem {
  /** 'METHOD /path' or the path. */
  where: string;
  rule: string;
  message: string;
}

/** Every break of the conventions in the contract. */
export function conventionProblems(doc: ContractLike): ConventionProblem[] {
  const out: ConventionProblem[] = [];
  const add = (where: string, rule: string, message: string) => out.push({ where, rule, message });
  const operationIds = new Map<string, string>();
  const collections = new Set(Object.keys(doc.paths).map((p) => p.split('/')[2]!));

  for (const [path, item] of Object.entries(doc.paths)) {
    if (!path.startsWith('/v1/')) add(path, 'version', 'Every path starts with /v1/');
    const segments = path.split('/').slice(2);
    segments.forEach((s, i) => {
      if (s.startsWith('{')) {
        const name = s.slice(1, -1);
        if (!CAMEL.test(name)) add(path, 'path-parameter', `{${name}} is not camelCase`);
        if (!name.endsWith('Id') && !NATURAL_KEYS.includes(name)) add(path, 'path-parameter', `{${name}} is neither an id ({xId}) nor a known natural key`);
        return;
      }
      if (!SEGMENT.test(s)) add(path, 'segment', `'${s}' is not lowercase kebab-case`);
      if (BANNED_SEGMENTS[s] || s.endsWith('-lookup')) add(path, 'segment', `'${s}': use ${BANNED_SEGMENTS[s] ?? 'a collection, e.g. animal-summaries'}`);
      if (s.endsWith('-settings')) add(path, 'settings', `'${s}': settings live under /v1/settings/{name}`);
      if (s.endsWith('-searches') || (s === 'searches' && i === 0)) add(path, 'search', `'${s}': a search is POST /v1/{collection}/searches`);
      // A top-level collection is not nested under another resource: /policies/{policyId}/animals/{animalId}.
      if (i > 0 && collections.has(s) && segments[i + 1]?.startsWith('{')) add(path, 'nesting', `'${s}' is a top-level collection; do not nest it under ${segments[0]}`);
      // Right under a collection comes an id, or searches; a filter is a query parameter (settings group named settings).
      if (i === 1 && segments[0] !== 'settings' && s !== 'searches') add(path, 'filter', `'${s}' right under /${segments[0]}: use /${segments[0]}/{id} or a query parameter`);
    });

    const shared = ((item as { parameters?: Operation['parameters'] }).parameters ?? []) as NonNullable<Operation['parameters']>;
    for (const [method, raw] of Object.entries(item)) {
      if (!METHODS.includes(method)) continue;
      const op = raw as Operation;
      const where = `${method.toUpperCase()} ${path}`;
      if (!op.operationId || !CAMEL.test(op.operationId)) add(where, 'operation-id', 'operationId is missing or not camelCase');
      else if (operationIds.has(op.operationId)) add(where, 'operation-id', `operationId ${op.operationId} is also ${operationIds.get(op.operationId)}`);
      else operationIds.set(op.operationId, where);
      if (!op.tags?.length) add(where, 'tags', 'The operation has no tag');

      const last = segments.at(-1) ?? '';
      if (method === 'post' && segments.length >= 3 && segments.at(-2)!.startsWith('{') && !last.startsWith('{') && !last.endsWith('s')) {
        add(where, 'action', `'${last}': an action on a resource is a plural noun, e.g. cancellations`);
      }

      for (const p0 of [...shared, ...(op.parameters ?? [])]) {
        const p = '$ref' in p0 ? doc.components?.parameters?.[p0.$ref.split('/').at(-1)!] : p0;
        if (!p) continue;
        if (p.in === 'path' && p.name.endsWith('Id') && !/^\^[a-z]{2,4}_/.test(p.schema?.pattern ?? '')) {
          add(where, 'id-pattern', `{${p.name}} needs a pattern with its id prefix, e.g. '^pol_[A-Za-z0-9]+$'`);
        }
        if (p.in !== 'query') continue;
        if (!CAMEL.test(p.name)) add(where, 'query', `?${p.name} is not camelCase`);
        if (p.name === 'state') add(where, 'query', '?state: the filter on where something is in its life is status');
        if (p.name.endsWith('PartyId') && !PARTY_ROLES.includes(p.name.slice(0, -'PartyId'.length))) {
          add(where, 'query', `?${p.name}: a party filter is {role}PartyId with a role in ${PARTY_ROLES.join(', ')}`);
        }
      }
    }
  }
  return out;
}

/**
 * Breaks known when the conventions were decided (ADR 0034), as 'rule where'.
 * They are fixed one by one; the check fails on a new break and on an entry
 * that no longer breaks anything, so the list only shrinks.
 */
export const KNOWN_DEVIATIONS: readonly string[] = [
  'query GET /v1/claims',
  'id-pattern GET /v1/claims/{claimId}',
  'id-pattern GET /v1/claims/{claimId}/assessment',
  'id-pattern GET /v1/claims/{claimId}/decisions',
  'id-pattern POST /v1/claims/{claimId}/decisions',
  'id-pattern GET /v1/claims/{claimId}/proposals',
  'id-pattern POST /v1/claims/{claimId}/proposals/{proposalId}/approvals',
  'id-pattern POST /v1/claims/{claimId}/proposals/{proposalId}/returns',
  'filter /v1/products/on-sale',
  'segment /v1/products/{product}/versions/{version}/sales-ends',
  'search /v1/party-searches',
  'settings /v1/retention-settings',
  'settings /v1/retention-settings/versions',
  'filter /v1/retention-settings/versions',
  'settings /v1/notice-settings',
  'settings /v1/notice-settings/versions',
  'filter /v1/notice-settings/versions',
  'query GET /v1/policy-groups',
  'segment /v1/policy-groups/{groupId}/members/{policyId}/ends',
  'segment /v1/animal-lookup',
  'filter /v1/access/roles',
  'filter /v1/access/roles/versions',
  'id-pattern POST /v1/claims/{claimId}/decisions/{seq}/replays',
  'id-pattern GET /v1/claims/{claimId}/decisions/{seq}/explanation',
  'id-pattern POST /v1/claims/{claimId}/decisions/{seq}/review-requests',
  'id-pattern GET /v1/claims/{claimId}/review-requests',
  'id-pattern POST /v1/claims/{claimId}/reassessments',
  'nesting /v1/policies/{policyId}/animals/{animalId}/limits',
  'id-pattern GET /v1/policies/{policyId}/animals/{animalId}/limits',
];

/** The breaks not in the known list, and the known entries that no longer break anything. */
export function conventionCheck(doc: ContractLike, known: readonly string[] = KNOWN_DEVIATIONS): { problems: ConventionProblem[]; fixed: string[] } {
  const all = conventionProblems(doc);
  const keys = new Set(all.map((p) => `${p.rule} ${p.where}`));
  return { problems: all.filter((p) => !known.includes(`${p.rule} ${p.where}`)), fixed: known.filter((k) => !keys.has(k)) };
}
