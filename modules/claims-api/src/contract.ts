import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { createRequire } from 'node:module';
import type { ValidateFunction, ErrorObject } from 'ajv';

// ajv och ajv-formats är CommonJS; läs in dem via require för stabil interop.
const require = createRequire(import.meta.url);
type AjvLike = {
  addSchema(schema: object): unknown;
  compile(schema: object): ValidateFunction;
};
const Ajv2020: new (opts: object) => AjvLike = require('ajv/dist/2020').default;
const addFormats: (ajv: AjvLike) => void = require('ajv-formats').default;

export const OPENAPI_PATH = fileURLToPath(new URL('../openapi.yaml', import.meta.url));

export interface OpenApiDoc {
  paths: Record<string, Record<string, { operationId?: string }>>;
  components: { schemas: Record<string, unknown> };
}

export const openapiText = readFileSync(OPENAPI_PATH, 'utf8');
export const openapi = parse(openapiText) as OpenApiDoc;

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema({ ...openapi, $id: 'openapi' });

const cache = new Map<string, ValidateFunction>();

/** Validator för ett namngivet schema i kontraktet, t.ex. 'ClaimInput'. */
export function validatorFor(schemaName: string): ValidateFunction {
  const cached = cache.get(schemaName);
  if (cached) return cached;
  if (!openapi.components.schemas[schemaName]) throw new Error(`Schemat ${schemaName} finns inte i kontraktet`);
  const v = ajv.compile({ $ref: `openapi#/components/schemas/${schemaName}` });
  cache.set(schemaName, v);
  return v;
}

export interface FieldError {
  path: string;
  message: string;
}

export function formatErrors(errors: ErrorObject[] | null | undefined): FieldError[] {
  return (errors ?? []).map((e) => ({
    path: e.instancePath || '/',
    message:
      e.keyword === 'additionalProperties'
        ? `okänt fält '${(e.params as { additionalProperty: string }).additionalProperty}'`
        : e.keyword === 'unevaluatedProperties'
          ? `okänt fält '${(e.params as { unevaluatedProperty: string }).unevaluatedProperty}'`
          : (e.message ?? 'ogiltigt värde'),
  }));
}

/** Alla operationer i kontraktet som 'METHOD /path'. */
export function contractOperations(): string[] {
  const methods = ['get', 'post', 'put', 'patch', 'delete'];
  return Object.entries(openapi.paths).flatMap(([path, item]) =>
    Object.keys(item)
      .filter((m) => methods.includes(m))
      .map((m) => `${m.toUpperCase()} ${path}`),
  );
}
