"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.seed = seed;
const builtins_1 = require("../app-registry/builtins");
// applications-service seed (dev/bootstrap) — provisions the built-in apps
// (Clock) so they show in the menu locally. Delegates to ensureBuiltins(), the
// single idempotent upsert-by-slug used on every boot (see src/index.ts), so the
// builtin manifest lives in exactly one place. IDEMPOTENT: existing rows are left
// untouched. Production provisioning happens via ensureBuiltins() at startup
// regardless of NODE_ENV; this seed just covers the dev runSeeds() path.
async function seed(_knex) {
    await (0, builtins_1.ensureBuiltins)();
    console.log('✅ Built-in apps seed delegated to ensureBuiltins (idempotent)');
}
//# sourceMappingURL=002_builtin_clock.js.map