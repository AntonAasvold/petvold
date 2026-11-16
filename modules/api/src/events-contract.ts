/**
 * The contract for events (ADR 0033): `asyncapi.yaml`. It must describe every
 * public event in the webhooks catalog, with exactly the fields of `data` the
 * catalog lets through, and the events Petvold sends must follow it.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { parse } from 'yaml';
import type { ValidateFunction } from 'ajv';
import { PUBLIC_EVENTS } from '@petvold/webhooks';

const require = createRequire(import.meta.url);
const Ajv2020: new (opts: object) => { addSchema(s: object): unknown; compile(s: object): ValidateFunction } = require('ajv/dist/2020').default;
const addFormats: (ajv: unknown) => void = require('ajv-formats').default;

export const ASYNCAPI_PATH = fileURLToPath(new URL('../asyncapi.yaml', import.meta.url));

interface AsyncApiDoc {
  asyncapi: string;
  components: {
    messages: Record<string, { name: string; payload: { allOf: [unknown, { properties: { data: { $ref: string } } }] } }>;
    schemas: Record<string, { properties?: Record<string, unknown>; required?: string[] }>;
  };
}

export const asyncapi = parse(readFileSync(ASYNCAPI_PATH, 'utf8')) as AsyncApiDoc;

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema({ ...asyncapi, $id: 'asyncapi' });

/** The message for an event type, e.g. 'policy.issued'. */
function messageFor(type: string) {
  return Object.entries(asyncapi.components.messages).find(([, m]) => m.name === `petvold.${type}.v1`);
}

/** A validator for the whole CloudEvent of a type, against its message's payload. */
export function eventValidator(type: string): ValidateFunction {
  const m = messageFor(type);
  if (!m) throw new Error(`No message for ${type} in asyncapi.yaml`);
  return ajv.compile({ $ref: `asyncapi#/components/messages/${m[0]}/payload` });
}

/** Where the contract and the catalog differ. Empty when they agree. */
export function eventContractProblems(): string[] {
  const out: string[] = [];
  const names = new Set(Object.values(asyncapi.components.messages).map((m) => m.name));
  for (const [type, spec] of Object.entries(PUBLIC_EVENTS)) {
    const m = messageFor(type);
    if (!m) {
      out.push(`${type}: no message petvold.${type}.v1`);
      continue;
    }
    const ref = m[1].payload.allOf[1].properties.data.$ref.split('/').at(-1)!;
    const fields = Object.keys(asyncapi.components.schemas[ref]?.properties ?? {}).sort();
    const allowed = [...new Set([spec.subject, ...spec.fields, ...(spec.subject === 'applicationId' ? ['policyId'] : [])])].sort();
    if (fields.join() !== allowed.join()) out.push(`${type}: data has [${fields.join(', ')}] in the contract, [${allowed.join(', ')}] in PUBLIC_EVENTS`);
    names.delete(`petvold.${type}.v1`);
  }
  for (const n of names) out.push(`${n}: in the contract but not in PUBLIC_EVENTS`);
  return out;
}
