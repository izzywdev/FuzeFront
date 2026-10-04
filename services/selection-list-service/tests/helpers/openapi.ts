// Response validation against the service's own OpenAPI contract (openapi.yaml 4.0.0).
//
// `assertConforms('SelectionList', body)` validates a live HTTP response body against
// `#/components/schemas/<name>` of the REAL spec file with Ajv (JSON Schema 2020-12, the
// dialect OpenAPI 3.1 uses). So a response that omits the required `seed` field, or
// renders `created_by` in a form the contract forbids, fails a test instead of reaching a
// client generated from the spec.
//
// Formats (date-time, uuid) are not checked (Ajv formats are an optional extra package);
// everything structural is: required, additionalProperties:false, enums, patterns, oneOf.

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import Ajv2020 from 'ajv/dist/2020';

const SPEC_PATH = path.join(__dirname, '..', '..', 'openapi.yaml');
const SPEC_ID = 'https://fuzefront.test/selection-list-service/openapi.yaml';

let ajv: Ajv2020 | undefined;

function getAjv(): Ajv2020 {
  if (ajv) return ajv;
  const doc = yaml.load(fs.readFileSync(SPEC_PATH, 'utf8')) as Record<string, unknown>;
  const instance = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
  // The whole document is the root schema so every `#/components/schemas/...` $ref resolves.
  instance.addSchema({ ...doc, $id: SPEC_ID }, SPEC_ID);
  ajv = instance;
  return instance;
}

/** The version declared by the spec under test (so a test can pin "this is the 4.x contract"). */
export function specVersion(): string {
  const doc = yaml.load(fs.readFileSync(SPEC_PATH, 'utf8')) as { info: { version: string } };
  return doc.info.version;
}

/** Validation errors of `body` against `#/components/schemas/<schemaName>` (empty = conforms). */
export function conformanceErrors(schemaName: string, body: unknown): string[] {
  const validate = getAjv().getSchema(`${SPEC_ID}#/components/schemas/${schemaName}`);
  if (!validate) throw new Error(`openapi.yaml has no components/schemas/${schemaName}`);
  if (validate(body)) return [];
  return (validate.errors ?? []).map((e) => `${e.instancePath || '(root)'} ${e.message}`);
}

/** Jest-friendly: throws with the full error list when `body` violates the contract. */
export function assertConforms(schemaName: string, body: unknown): void {
  const errors = conformanceErrors(schemaName, body);
  if (errors.length > 0) {
    throw new Error(`response does not conform to openapi.yaml ${schemaName}:\n  ${errors.join('\n  ')}\nbody: ${JSON.stringify(body)}`);
  }
}
