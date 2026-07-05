"use strict";
// Per-product authorization policy declaration + merge.
//
// A consumer product (e.g. FuzeMarket) declares its OWN resources/actions/roles
// using *bare* keys (Listing, Order, seller, buyer, …). The platform namespaces
// them by the product key (fuzemarket.Listing, fuzemarket.seller, …) so two
// products can both have a "Listing" or an "admin" role without colliding, then
// MERGES the namespaced definitions into the base platform schema before syncing
// to Permit.io. See sync-permit-schema.ts and
// docs/consumers/authn-authz-integration.md.
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProductPolicyError = exports.PRODUCT_NS_SEP = void 0;
exports.namespaceKey = namespaceKey;
exports.validateProductPolicy = validateProductPolicy;
exports.namespaceProductPolicy = namespaceProductPolicy;
exports.mergeProductPolicy = mergeProductPolicy;
exports.buildEnvSchema = buildEnvSchema;
const schema_1 = require("./schema");
// Separator between a product key and its bare resource/role key. A dot reads as
// the intended `fuzemarket.Listing` form and never collides with the `:` used in
// permission strings ("<ResourceKey>:<action>"). Kept as a single constant so the
// whole platform agrees on one convention.
exports.PRODUCT_NS_SEP = '.';
const PRODUCT_KEY_RE = /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/;
const BARE_KEY_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;
class ProductPolicyError extends Error {
}
exports.ProductPolicyError = ProductPolicyError;
/** Namespaced Permit key for a product's bare resource/role key. */
function namespaceKey(product, bareKey) {
    return `${product}${exports.PRODUCT_NS_SEP}${bareKey}`;
}
// Validate a product policy in isolation (shape, key charset, internal
// references). Throws ProductPolicyError on the first problem.
function validateProductPolicy(policy) {
    if (!policy || typeof policy !== 'object') {
        throw new ProductPolicyError('Product policy must be an object');
    }
    if (!PRODUCT_KEY_RE.test(policy.product)) {
        throw new ProductPolicyError(`Invalid product key "${policy.product}": expected lowercase [a-z0-9-], e.g. "fuzemarket"`);
    }
    if (!Array.isArray(policy.resources) || !Array.isArray(policy.roles)) {
        throw new ProductPolicyError('Product policy must declare resources[] and roles[]');
    }
    const resourceKeys = new Set();
    for (const r of policy.resources) {
        if (!BARE_KEY_RE.test(r.key)) {
            throw new ProductPolicyError(`Invalid resource key "${r.key}" in product "${policy.product}"`);
        }
        if (resourceKeys.has(r.key)) {
            throw new ProductPolicyError(`Duplicate resource "${r.key}" in product "${policy.product}"`);
        }
        resourceKeys.add(r.key);
        if (!r.actions || Object.keys(r.actions).length === 0) {
            throw new ProductPolicyError(`Resource "${r.key}" must declare at least one action`);
        }
    }
    const roleKeys = new Set();
    for (const role of policy.roles) {
        if (!BARE_KEY_RE.test(role.key)) {
            throw new ProductPolicyError(`Invalid role key "${role.key}" in product "${policy.product}"`);
        }
        if (roleKeys.has(role.key)) {
            throw new ProductPolicyError(`Duplicate role "${role.key}" in product "${policy.product}"`);
        }
        roleKeys.add(role.key);
        for (const perm of role.permissions) {
            const [resKey, actionKey] = perm.split(':');
            if (!resKey || !actionKey) {
                throw new ProductPolicyError(`Malformed permission "${perm}" in role "${role.key}" (expected "Resource:action")`);
            }
            const res = policy.resources.find(r => r.key === resKey);
            if (!res) {
                throw new ProductPolicyError(`Role "${role.key}" references unknown resource "${resKey}" — declare it in resources[]`);
            }
            if (!res.actions[actionKey]) {
                throw new ProductPolicyError(`Role "${role.key}" references unknown action "${actionKey}" on resource "${resKey}"`);
            }
        }
    }
}
// Convert a (validated) product policy into namespaced Permit resource/role defs.
function namespaceProductPolicy(policy) {
    validateProductPolicy(policy);
    const prefix = policy.name ?? policy.product;
    const resources = policy.resources.map(r => ({
        key: namespaceKey(policy.product, r.key),
        name: `${prefix} ${r.name}`,
        actions: r.actions,
    }));
    const roles = policy.roles.map(role => ({
        key: namespaceKey(policy.product, role.key),
        name: `${prefix} ${role.name}`,
        permissions: role.permissions.map(perm => {
            const [resKey, actionKey] = perm.split(':');
            return `${namespaceKey(policy.product, resKey)}:${actionKey}`;
        }),
    }));
    return { resources, roles };
}
// Merge one or more product policies into a base platform schema. Pure: returns a
// new PermitSchema and never mutates its inputs. Throws ProductPolicyError on a
// namespaced-key collision (defensive — two products SHOULD be isolated by
// namespace, but re-using the same `product` key twice would collide).
function mergeProductPolicy(base, ...policies) {
    const resources = [...base.resources];
    const roles = [...base.roles];
    const resourceKeys = new Set(resources.map(r => r.key));
    const roleKeys = new Set(roles.map(r => r.key));
    for (const policy of policies) {
        const ns = namespaceProductPolicy(policy);
        for (const r of ns.resources) {
            if (resourceKeys.has(r.key)) {
                throw new ProductPolicyError(`Resource key collision on merge: "${r.key}"`);
            }
            resourceKeys.add(r.key);
            resources.push(r);
        }
        for (const role of ns.roles) {
            if (roleKeys.has(role.key)) {
                throw new ProductPolicyError(`Role key collision on merge: "${role.key}"`);
            }
            roleKeys.add(role.key);
            roles.push(role);
        }
    }
    return { resources, roles };
}
// Convenience: build the full env schema from the platform base + the given
// product policies. This is what the sync entrypoint should pass to Permit.
function buildEnvSchema(...policies) {
    return mergeProductPolicy(schema_1.permitSchema, ...policies);
}
//# sourceMappingURL=product-policy.js.map