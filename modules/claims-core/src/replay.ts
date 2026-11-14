/**
 * Recalculation of stored decisions (ADR 0018).
 *
 * A decision is proven by running its stored evidence through the same
 * calculation model again and getting exactly the stored assessment back.
 * Every calculation model the engine has ever used stays here, so old
 * decisions can be recalculated after the code has changed.
 */
import { CALCULATION_MODEL, assess } from './assess.ts';
import type { Assessment, AssessmentInput, DecisionEvidence } from './types.ts';
import { sha256 } from './util.ts';

/** Calculation model -> implementation. A correction that changes results is a new entry; old ones are never removed. */
export const CALCULATION_MODELS: Readonly<Record<string, (input: AssessmentInput) => Assessment>> = {
  [CALCULATION_MODEL]: assess,
};

export interface Difference {
  /** JSON pointer into the assessment, e.g. '/calculation/payout'. */
  path: string;
  stored?: unknown;
  replayed?: unknown;
}

export interface ReplayResult {
  decisionId: string;
  calculationModel: string;
  engineVersion: string;
  replayedWith: { engineVersion: string };
  status: 'identical' | 'different' | 'model_unavailable';
  /** The stored input still hashes to the stored assessment's inputHash. */
  inputHashMatches: boolean;
  differences: Difference[];
}

const MAX_DIFFERENCES = 50;

/** Runs the evidence through its calculation model again and compares with the stored assessment. Pure. */
export function replay(evidence: DecisionEvidence, stored: Assessment, currentEngineVersion: string): ReplayResult {
  const base = {
    decisionId: evidence.decisionId,
    calculationModel: evidence.calculationModel,
    engineVersion: evidence.engineVersion,
    replayedWith: { engineVersion: currentEngineVersion },
    inputHashMatches: sha256(evidence.input) === stored.inputHash,
  };
  const model = CALCULATION_MODELS[evidence.calculationModel];
  if (!model) return { ...base, status: 'model_unavailable', differences: [] };
  const differences = diff(stored, model(evidence.input)).slice(0, MAX_DIFFERENCES);
  return { ...base, status: differences.length === 0 && base.inputHashMatches ? 'identical' : 'different', differences };
}

/** Differences between two JSON values as JSON pointers. Keys with undefined count as missing, as in JSON. */
export function diff(stored: unknown, replayed: unknown, path = ''): Difference[] {
  if (isObject(stored) && isObject(replayed)) {
    const keys = [...new Set([...Object.keys(stored), ...Object.keys(replayed)])].sort();
    return keys.flatMap((k) => diff(stored[k], replayed[k], `${path}/${escape(k)}`));
  }
  if (Array.isArray(stored) && Array.isArray(replayed)) {
    const n = Math.max(stored.length, replayed.length);
    return Array.from({ length: n }, (_, i) => diff(stored[i], replayed[i], `${path}/${i}`)).flat();
  }
  if (stored === replayed) return [];
  return [{ path: path || '/', ...(stored !== undefined ? { stored } : {}), ...(replayed !== undefined ? { replayed } : {}) }];
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function escape(key: string): string {
  return key.replaceAll('~', '~0').replaceAll('/', '~1');
}
