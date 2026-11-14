/**
 * Scenarios as data (layer 3, ADR 0012 and 0018).
 *
 * scenarios/claims/<market-product>/product.yaml holds the defaults (rules,
 * policy, claim). Every other *.yaml is a scenario: what is given, merged into
 * the defaults, and what the assessment is expected to be. Readable without code.
 *
 * Each scenario also has a frozen golden file (<name>.golden.json) with the
 * full input, the full assessment and the calculation model. The test replays
 * every golden file, so a code change that would alter the result of an old
 * decision stops the build. Golden files are written only when missing
 * (npm run scenarios:golden); an existing one is never overwritten.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import type { Assessment, AssessmentInput, ClaimsRules, PolicySnapshot, Claim } from '../src/types.ts';

export const SCENARIO_ROOT = fileURLToPath(new URL('../../../scenarios/claims/', import.meta.url));

export interface ScenarioExpectation {
  proposedOutcome?: Assessment['proposedOutcome'];
  mode?: Assessment['mode'];
  /** Subset of the calculation, or null when no calculation is expected. */
  calculation?: Record<string, unknown> | null;
  /** Rule code -> a status at least one result with that code must have. */
  rules?: Record<string, string>;
}

export interface Scenario {
  /** e.g. 'se-dog/otitis-auto' */
  id: string;
  name: string;
  description?: string;
  input: AssessmentInput;
  expect: ScenarioExpectation;
  goldenPath: string;
}

export interface Golden {
  scenario: string;
  calculationModel: string;
  input: AssessmentInput;
  assessment: Assessment;
}

interface Product {
  rules: ClaimsRules;
  policy: PolicySnapshot;
  claim: Claim;
}

interface ScenarioFile {
  name: string;
  description?: string;
  given?: {
    claim?: Partial<Claim>;
    policy?: Partial<PolicySnapshot> | null;
    rules?: Partial<ClaimsRules>;
    openDeductiblePeriod?: AssessmentInput['openDeductiblePeriod'];
    consumedBefore?: number;
  };
  expect: ScenarioExpectation;
}

/** All scenarios, sorted, with their input built from the product defaults. */
export function loadScenarios(root = SCENARIO_ROOT): Scenario[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .flatMap((dir) => {
      const product = parse(readFileSync(join(root, dir, 'product.yaml'), 'utf8')) as Product;
      return readdirSync(join(root, dir))
        .filter((f) => f.endsWith('.yaml') && f !== 'product.yaml')
        .sort()
        .map((f) => {
          const file = parse(readFileSync(join(root, dir, f), 'utf8')) as ScenarioFile;
          const g = file.given ?? {};
          const base = f.replace(/\.yaml$/, '');
          return {
            id: `${dir}/${base}`,
            name: file.name,
            ...(file.description ? { description: file.description } : {}),
            input: {
              claim: merge(product.claim, g.claim) as Claim,
              policy: g.policy === null ? null : (merge(product.policy, g.policy) as PolicySnapshot),
              rules: merge(product.rules, g.rules) as ClaimsRules,
              openDeductiblePeriod: g.openDeductiblePeriod ?? null,
              consumedBefore: g.consumedBefore ?? 0,
            },
            expect: file.expect,
            goldenPath: join(root, dir, `${base}.golden.json`),
          };
        });
    });
}

export function readGolden(s: Scenario): Golden | null {
  return existsSync(s.goldenPath) ? (JSON.parse(readFileSync(s.goldenPath, 'utf8')) as Golden) : null;
}

/** Deep merge: objects merge key by key, arrays and other values replace. */
function merge(base: unknown, over: unknown): unknown {
  if (over === undefined) return structuredClone(base);
  if (isObject(base) && isObject(over)) {
    const out: Record<string, unknown> = structuredClone(base);
    for (const [k, v] of Object.entries(over)) out[k] = merge(base[k], v);
    return out;
  }
  return structuredClone(over);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
