/** The contract's naming conventions (ADR 0034). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conventionCheck, conventionProblems, type ContractLike } from '../src/conventions.ts';
import { openapi } from '../src/contract.ts';

const op = (o: Record<string, unknown> = {}) => ({ operationId: 'doIt', tags: ['x'], ...o });
const rules = (doc: ContractLike) => conventionProblems(doc).map((p) => `${p.rule} ${p.where}`);

test('a contract that follows the conventions has no problems', () => {
  const id = { name: 'policyId', in: 'path', schema: { pattern: '^pol_[A-Za-z0-9]+$' } };
  const doc: ContractLike = {
    paths: {
      '/v1/policies': { get: op({ operationId: 'listPolicies', parameters: [{ name: 'policyholderPartyId', in: 'query' }, { name: 'status', in: 'query' }] }) },
      '/v1/policies/{policyId}/cancellations': { parameters: [id], post: op({ operationId: 'cancelPolicy' }) },
      '/v1/parties/searches': { post: op({ operationId: 'searchParties' }) },
      '/v1/settings/retention/versions': { get: op({ operationId: 'listRetention' }) },
      '/v1/products/{product}/versions/{version}/sales-endings': { post: op({ operationId: 'endSales' }) },
    },
  };
  assert.deepEqual(conventionProblems(doc), []);
});

test('each rule finds its break', () => {
  const doc: ContractLike = {
    paths: {
      '/v1/Policies': { get: op({ operationId: 'a' }) },
      '/v1/policies/{policyId}/animals/{animalId}/limits': { get: op({ operationId: 'b', parameters: [{ name: 'policyId', in: 'path' }] }) },
      '/v1/animals/{animalId}': { get: op({ operationId: 'c', parameters: [{ name: 'animalId', in: 'path', schema: { pattern: '^ani_[a-z]+$' } }] }) },
      '/v1/animal-lookup': { get: op({ operationId: 'd' }) },
      '/v1/party-searches': { post: op({ operationId: 'e' }) },
      '/v1/notice-settings': { get: op({ operationId: 'f' }) },
      '/v1/products/on-sale': { get: op({ operationId: 'g', parameters: [{ name: 'state', in: 'query' }, { name: 'holderPartyId', in: 'query' }] }) },
      '/v1/policies/{policyId}/cancel': { post: op({ operationId: 'h' }) },
      '/v1/groups/{groupId}/members/{policyId}/ends': { post: op({ operationId: 'h', tags: [] }) },
    },
  };
  assert.deepEqual(rules(doc), [
    'segment /v1/Policies',
    'nesting /v1/policies/{policyId}/animals/{animalId}/limits',
    'id-pattern GET /v1/policies/{policyId}/animals/{animalId}/limits',
    'segment /v1/animal-lookup',
    'search /v1/party-searches',
    'settings /v1/notice-settings',
    'filter /v1/products/on-sale',
    'query GET /v1/products/on-sale',
    'query GET /v1/products/on-sale',
    'action POST /v1/policies/{policyId}/cancel',
    'segment /v1/groups/{groupId}/members/{policyId}/ends',
    'operation-id POST /v1/groups/{groupId}/members/{policyId}/ends',
    'tags POST /v1/groups/{groupId}/members/{policyId}/ends',
  ]);
});

test('known breaks only shrink: a new break and a fixed entry both fail', () => {
  const doc: ContractLike = { paths: { '/v1/animal-lookup': { get: op() } } };
  assert.deepEqual(conventionCheck(doc, ['segment /v1/animal-lookup']), { problems: [], fixed: [] });
  assert.deepEqual(conventionCheck(doc, ['segment /v1/animal-lookup', 'segment /v1/gone']).fixed, ['segment /v1/gone']);
  assert.equal(conventionCheck(doc, []).problems.length, 1);
  // The real contract.
  assert.deepEqual(conventionCheck(openapi as never), { problems: [], fixed: [] });
});
