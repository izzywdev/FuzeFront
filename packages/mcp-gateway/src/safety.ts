/**
 * Guards for object keys that come from untrusted input.
 *
 * Two untrusted sources feed this gateway, and both end up as object keys:
 *
 *   1. The OpenAPI document. It is mounted config, but it is authored per
 *      product and travels through a ConfigMap — it is not this package's own
 *      source, and a `$ref` or a parameter name from it is attacker-influenced
 *      input as far as this code is concerned.
 *   2. The tool arguments an LLM client sends. Those are model-generated and
 *      therefore fully untrusted.
 *
 * A key of `__proto__`, `constructor` or `prototype` in either place reaches
 * `Object.prototype` — on a read it leaks internals into a tool schema, and on
 * a write it pollutes every object in the process. The blast radius is a tool
 * surface an agent will then call, so these are refused outright rather than
 * sanitised into something plausible.
 */

/** Keys that resolve to the prototype chain rather than to own data. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function isForbiddenKey(key: string): boolean {
  return FORBIDDEN_KEYS.has(key);
}

/**
 * A dictionary with NO prototype. Assigning `__proto__` to one of these stores
 * an ordinary own property instead of reparenting the object, so it is safe as
 * an accumulator even if a guard upstream is ever removed.
 */
export function safeRecord<T = unknown>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

/**
 * Read a property ONLY if the object owns it. `obj[key]` would happily return
 * `Object.prototype.constructor` for a key of `constructor`; this returns
 * undefined, which is what "the caller did not supply that argument" means.
 */
export function getOwn(obj: unknown, key: string): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  if (isForbiddenKey(key)) return undefined;
  if (!Object.prototype.hasOwnProperty.call(obj, key)) return undefined;
  return (obj as Record<string, unknown>)[key];
}

/**
 * Throw if a spec-derived identifier would touch the prototype chain. Used at
 * build time so a hostile spec fails the pod at boot rather than producing a
 * tool whose behaviour depends on `Object.prototype`.
 */
export function assertSafeKey(key: string, context: string): void {
  if (isForbiddenKey(key)) {
    throw new Error(
      `Refusing "${key}" as ${context}: it resolves to the object prototype rather than to data.`
    );
  }
}
