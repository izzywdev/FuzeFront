/**
 * OpenAPI -> MCP tool descriptors.
 *
 * The gateway is "merely a layer that exposes the REST API as tools": there is
 * no per-product logic here, and adding a product means pointing a pod at a
 * different spec, never editing this file.
 */

import { classify, type Classification, type Overrides } from './classify.js';

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options'] as const;

export interface ToolParam {
  name: string;
  in: 'path' | 'query' | 'header';
  required: boolean;
  schema: Record<string, unknown>;
  description?: string;
}

export interface ToolDescriptor {
  name: string;
  description: string;
  method: string;
  path: string;
  params: ToolParam[];
  /** JSON Schema for the request body, if the operation takes one. */
  bodySchema?: Record<string, unknown>;
  bodyRequired: boolean;
  classification: Classification;
  inputSchema: Record<string, unknown>;
}

export interface OpenApiDoc {
  openapi?: string;
  info?: { title?: string; version?: string };
  servers?: Array<{ url?: string }>;
  paths?: Record<string, Record<string, unknown>>;
  components?: Record<string, unknown>;
}

/**
 * Resolve a local `$ref` against the document. Remote refs are NOT followed:
 * the gateway must not make network calls to understand its own config, and a
 * spec that depends on fetching another host at boot is a spec that fails
 * differently in every environment.
 */
function resolveRef(doc: OpenApiDoc, node: unknown, seen = new Set<string>()): unknown {
  if (!node || typeof node !== 'object') return node;
  const obj = node as Record<string, unknown>;
  const ref = obj.$ref;
  if (typeof ref !== 'string') return node;

  if (!ref.startsWith('#/')) {
    throw new Error(`Remote $ref is not supported: ${ref}. Bundle the spec before mounting it.`);
  }
  if (seen.has(ref)) return {}; // circular — stop, do not hang
  seen.add(ref);

  const parts = ref.slice(2).split('/').map(p => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  let cur: unknown = doc;
  for (const p of parts) {
    if (!cur || typeof cur !== 'object') return {};
    cur = (cur as Record<string, unknown>)[p];
  }
  return resolveRef(doc, cur, seen);
}

/** Turn an operation into a stable, MCP-legal tool name. */
export function toolNameFor(operationId: unknown, method: string, path: string): string {
  if (typeof operationId === 'string' && operationId.trim()) {
    return operationId.trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  }
  const slug = path
    .replace(/\{([^}]+)\}/g, 'by_$1')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `${method.toLowerCase()}_${slug}`.slice(0, 64);
}

function buildInputSchema(params: ToolParam[], bodySchema?: Record<string, unknown>, bodyRequired = false) {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const p of params) {
    properties[p.name] = p.description ? { ...p.schema, description: p.description } : p.schema;
    if (p.required) required.push(p.name);
  }

  if (bodySchema) {
    properties.body = { ...bodySchema, description: 'Request body.' };
    if (bodyRequired) required.push('body');
  }

  return {
    type: 'object',
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: false,
  };
}

/**
 * Build the full tool list for a spec. Throws if any classification invariant is
 * violated, so a bad overrides file stops the pod at boot instead of at the
 * first dangerous call.
 */
export function buildTools(doc: OpenApiDoc, overrides: Overrides = {}): ToolDescriptor[] {
  const tools: ToolDescriptor[] = [];
  const paths = doc.paths ?? {};
  const seenNames = new Set<string>();

  for (const [path, pathItemRaw] of Object.entries(paths)) {
    const pathItem = (resolveRef(doc, pathItemRaw) ?? {}) as Record<string, unknown>;
    // Parameters declared once for the whole path apply to every operation.
    const sharedParams = Array.isArray(pathItem.parameters) ? pathItem.parameters : [];

    for (const method of HTTP_METHODS) {
      const opRaw = pathItem[method];
      if (!opRaw || typeof opRaw !== 'object') continue;
      const op = opRaw as Record<string, unknown>;

      const name = toolNameFor(op.operationId, method, path);
      if (seenNames.has(name)) {
        throw new Error(
          `Duplicate tool name "${name}" (${method.toUpperCase()} ${path}). ` +
            `Give the operation a unique operationId in the spec.`
        );
      }
      seenNames.add(name);

      const rawParams = [...sharedParams, ...(Array.isArray(op.parameters) ? op.parameters : [])];
      const params: ToolParam[] = [];
      for (const rp of rawParams) {
        const p = (resolveRef(doc, rp) ?? {}) as Record<string, unknown>;
        const loc = p.in;
        if (loc !== 'path' && loc !== 'query' && loc !== 'header') continue;
        if (typeof p.name !== 'string') continue;
        params.push({
          name: p.name,
          in: loc,
          required: Boolean(p.required) || loc === 'path',
          schema: ((resolveRef(doc, p.schema) as Record<string, unknown>) ?? { type: 'string' }),
          description: typeof p.description === 'string' ? p.description : undefined,
        });
      }

      let bodySchema: Record<string, unknown> | undefined;
      let bodyRequired = false;
      const rb = resolveRef(doc, op.requestBody) as Record<string, unknown> | undefined;
      if (rb && typeof rb === 'object') {
        bodyRequired = Boolean(rb.required);
        const content = rb.content as Record<string, unknown> | undefined;
        const json = content?.['application/json'] as Record<string, unknown> | undefined;
        if (json?.schema) {
          bodySchema = (resolveRef(doc, json.schema) as Record<string, unknown>) ?? {};
        }
      }

      const classification = classify(method, path, name, overrides[name]);

      const summary =
        (typeof op.summary === 'string' && op.summary) ||
        (typeof op.description === 'string' && op.description) ||
        `${method.toUpperCase()} ${path}`;

      // The description carries the safety facts, because the model choosing a
      // tool sees the description and not our internal metadata.
      const safety = classification.mutates
        ? `[WRITE${classification.reversibility === 'irreversible' ? ' — IRREVERSIBLE' : ''}]`
        : '[READ-ONLY]';

      tools.push({
        name,
        description: `${safety} ${summary} (${method.toUpperCase()} ${path}). ${classification.reason}.`,
        method,
        path,
        params,
        bodySchema,
        bodyRequired,
        classification,
        inputSchema: buildInputSchema(params, bodySchema, bodyRequired),
      });
    }
  }

  return tools;
}
