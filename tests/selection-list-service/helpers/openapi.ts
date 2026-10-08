/**
 * Response validation against the FROZEN OpenAPI contract
 * (services/selection-list-service/openapi.yaml, 4.0.0).
 *
 * This suite is a black box: it validates what the service puts on the wire against the
 * spec FILE, never against the implementation's own types. A response that omits the
 * required nullable `seed`, renders `created_by` in a form `AuthorPrincipal` forbids, or
 * carries a property the spec does not declare (`additionalProperties: false`) fails here.
 *
 * Ajv, JSON Schema 2020-12 (the dialect OpenAPI 3.1 uses). Formats (date-time/uuid) are not
 * asserted by Ajv here; everything structural is (required, additionalProperties, enums,
 * patterns, oneOf, nullable unions).
 */
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import Ajv2020 from 'ajv/dist/2020';

export const SPEC_PATH = path.join(__dirname, '..', '..', '..', 'services', 'selection-list-service', 'openapi.yaml');
const SPEC_ID = 'https://fuzefront.test/selection-list-service/openapi.yaml';

type Json = Record<string, unknown>;

let doc: Json | undefined;
let ajv: Ajv2020 | undefined;

export function loadSpec(): Json {
  if (!doc) doc = yaml.load(fs.readFileSync(SPEC_PATH, 'utf8')) as Json;
  return doc;
}

export function specVersion(): string {
  return (loadSpec()['info'] as { version: string }).version;
}

function getAjv(): Ajv2020 {
  if (ajv) return ajv;
  const instance = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
  // The whole document is the root schema so every `#/components/schemas/...` $ref resolves.
  instance.addSchema({ ...loadSpec(), $id: SPEC_ID }, SPEC_ID);
  ajv = instance;
  return instance;
}

/** Validation errors of `body` against `#/components/schemas/<name>` (empty = conforms). */
export function schemaErrors(schemaName: string, body: unknown): string[] {
  const validate = getAjv().getSchema(`${SPEC_ID}#/components/schemas/${schemaName}`);
  if (!validate) throw new Error(`openapi.yaml has no components/schemas/${schemaName}`);
  if (validate(body)) return [];
  return (validate.errors ?? []).map((e) => `${e.instancePath || '(root)'} ${e.message}`);
}

export function assertSchema(schemaName: string, body: unknown): void {
  const errors = schemaErrors(schemaName, body);
  if (errors.length > 0) {
    throw new Error(
      `body does not conform to openapi.yaml components/schemas/${schemaName}:\n  ${errors.join('\n  ')}\nbody: ${JSON.stringify(body)}`,
    );
  }
}

const esc = (s: string) => s.replace(/~/g, '~0').replace(/\//g, '~1');

/**
 * Validate a response body against the schema the spec declares for
 * `<method> <pathTemplate>` at `<status>` (application/json). `pathTemplate` is the spec's own
 * template, e.g. `/v1/selection-lists/{listId}`.
 */
export function responseErrors(method: string, pathTemplate: string, status: number, body: unknown): string[] {
  const paths = loadSpec()['paths'] as Record<string, Record<string, { responses?: Record<string, unknown> }>>;
  const op = paths[pathTemplate]?.[method.toLowerCase()];
  if (!op) throw new Error(`openapi.yaml declares no ${method} ${pathTemplate}`);
  let response = op.responses?.[String(status)] as { $ref?: string; content?: Record<string, { schema?: unknown }> } | undefined;
  if (!response) return [`status ${status} is not declared for ${method} ${pathTemplate} (declared: ${Object.keys(op.responses ?? {}).join(', ')})`];
  if (response.$ref) {
    const name = response.$ref.replace('#/components/responses/', '');
    response = (loadSpec()['components'] as { responses: Record<string, typeof response> }).responses[name];
  }
  const json = response?.content?.['application/json'];
  if (!json?.schema) return body === null || body === '' ? [] : [`${method} ${pathTemplate} ${status} declares no JSON body but one was returned`];
  const pointer = `#/paths/${esc(pathTemplate)}/${method.toLowerCase()}/responses/${status}/content/application~1json/schema`;
  const direct = getAjv().getSchema(`${SPEC_ID}${pointer}`);
  if (direct) {
    if (direct(body)) return [];
    return (direct.errors ?? []).map((e) => `${e.instancePath || '(root)'} ${e.message}`);
  }
  return [`no compiled schema for ${method} ${pathTemplate} ${status}`];
}

/** Validation errors of a request body against the schema the spec declares for `<method> <pathTemplate>`. */
export function requestBodyErrors(method: string, pathTemplate: string, body: unknown): string[] {
  const pointer = `#/paths/${esc(pathTemplate)}/${method.toLowerCase()}/requestBody/content/application~1json/schema`;
  const validate = getAjv().getSchema(`${SPEC_ID}${pointer}`);
  if (!validate) return [`openapi.yaml declares no JSON request body for ${method} ${pathTemplate}`];
  if (validate(body)) return [];
  return (validate.errors ?? []).map((e) => `${e.instancePath || '(root)'} ${e.message}`);
}

export function assertResponse(method: string, pathTemplate: string, status: number, body: unknown): void {
  const errors = responseErrors(method, pathTemplate, status, body);
  if (errors.length > 0) {
    throw new Error(`${method} ${pathTemplate} -> ${status} violates openapi.yaml:\n  ${errors.join('\n  ')}\nbody: ${JSON.stringify(body)}`);
  }
}
