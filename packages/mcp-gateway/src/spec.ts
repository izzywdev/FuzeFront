/**
 * OpenAPI -> MCP tool descriptors.
 *
 * The gateway is "merely a layer that exposes the REST API as tools": there is
 * no per-product logic here, and adding a product means pointing a pod at a
 * different spec, never editing this file.
 */

import { classify, type Classification, type Overrides } from './classify.js';
import { assertSafeKey, getOwn, isForbiddenKey, safeRecord } from './safety.js';

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
  /** Raw spec prose, kept alongside the built description for the offline generator to read (never re-parses the doc itself). */
  specSummary?: string;
  specDescription?: string;
}

/**
 * toolName -> build-time LLM-generated prose (descriptions.ts /
 * scripts/generate-descriptions.mjs). OPTIONAL and PURELY COSMETIC: it can
 * only replace the human-readable sentence in a tool's `description`. It is
 * never consulted by `classify()`, never touches `mutates`/`reversibility`,
 * and the `${safety}` prefix + method/path + classification reason below are
 * computed from the untouched mechanical path regardless of whether an entry
 * is present here.
 */
export type GeneratedDescriptions = Record<string, string>;

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

  // Validate EVERY segment before walking any of them. Checking lazily inside
  // the loop would only reject a hostile segment when traversal happened to
  // reach it, so `#/absent/__proto__` would pass simply because `absent` is
  // missing — the pointer would be judged safe for the wrong reason.
  for (const p of parts) {
    // A segment of __proto__/constructor/prototype walks onto Object.prototype
    // instead of into the document. A spec containing one is hostile or broken,
    // and either way the tool built from it would describe the JavaScript
    // runtime rather than the product's API.
    if (isForbiddenKey(p)) {
      throw new Error(
        `Refusing $ref "${ref}": segment "${p}" resolves to the object prototype, not to the document.`
      );
    }
  }

  let cur: unknown = doc;
  for (const p of parts) {
    if (!cur || typeof cur !== 'object') return {};
    cur = getOwn(cur, p);
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
  // Accumulate in a Map rather than assigning into an object under a
  // spec-supplied key. A Map cannot reach Object.prototype at all, so this is
  // immune by construction rather than by a guard someone could later delete —
  // and it carries no `obj[dynamicKey] = …` shape for a scanner to flag.
  //
  // Two guards already stood behind this line: parameter names pass
  // assertSafeKey() at parse time, and the accumulator was already
  // null-prototype. Both still hold for the materialised result below; this
  // removes the last write-by-dynamic-key rather than suppressing the warning.
  const collected = new Map<string, unknown>();
  const required: string[] = [];

  for (const p of params) {
    collected.set(p.name, p.description ? { ...p.schema, description: p.description } : p.schema);
    if (p.required) required.push(p.name);
  }

  if (bodySchema) {
    collected.set('body', { ...bodySchema, description: 'Request body.' });
    if (bodyRequired) required.push('body');
  }

  // Materialise into a null-prototype object. defineProperty writes an own data
  // property under any key without consulting the prototype chain, and
  // JSON.stringify treats the result exactly like a plain object, so the
  // emitted tool schema is byte-identical to before.
  const properties = safeRecord();
  for (const [key, value] of collected) {
    Object.defineProperty(properties, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
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
export function buildTools(
  doc: OpenApiDoc,
  overrides: Overrides = {},
  generatedDescriptions: GeneratedDescriptions = {}
): ToolDescriptor[] {
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
      assertSafeKey(name, `a tool name (${method.toUpperCase()} ${path})`);
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
        // The parameter name becomes a key in the tool's input schema and is
        // used to index the caller's arguments, so it must not be a prototype key.
        assertSafeKey(p.name, `a parameter name on ${method.toUpperCase()} ${path}`);
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

      // Classification is computed FIRST, from the method/path/overrides alone
      // — nothing below this line can reach it or change it. generatedDescriptions
      // is consulted only for the prose sentence a few lines down.
      const classification = classify(method, path, name, overrides[name]);

      const specSummary = typeof op.summary === 'string' && op.summary ? op.summary : undefined;
      const specDescription = typeof op.description === 'string' && op.description ? op.description : undefined;

      // Precedence: build-time LLM prose (if the mounted cache has a fresh,
      // matching entry) > the spec's own summary/description > a mechanical
      // fallback. Whichever wins, it is ONLY the descriptive sentence — the
      // safety prefix, method/path and classification reason immediately below
      // are always the mechanical values, never influenced by this choice.
      const generated = generatedDescriptions[name];
      const summary =
        (typeof generated === 'string' && generated.trim() && generated.trim()) ||
        specSummary ||
        specDescription ||
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
        specSummary,
        specDescription,
      });
    }
  }

  return tools;
}
