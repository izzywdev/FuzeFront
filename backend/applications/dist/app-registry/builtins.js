"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureBuiltins = ensureBuiltins;
const crypto_1 = require("crypto");
const service_1 = require("./service");
const manifest_schema_1 = require("./manifest.schema");
// Built-in apps shipped with the platform. Provisioned idempotently on boot
// (production included) so they appear in the menu out of the box. The canonical
// manifest source is services/app-registry-service/seed/clock.manifest.json, but
// that path is not present in the applications-service container image
// (backend/applications/Dockerfile copies only backend/applications + core +
// shared), so the manifest is embedded here verbatim and validated against the
// FROZEN AppManifest contract on load.
const BUILTIN_MANIFESTS = [
    {
        manifestVersion: '1',
        slug: 'clock',
        name: 'Clock',
        menuLabel: 'Clock',
        description: 'Built-in reference app: a simple world clock. The canonical example of a federated, portal-mode FuzeFront app, shipped with the platform.',
        icon: { kind: 'emoji', value: '🕐' },
        mode: 'portal',
        builtin: true,
        integration: {
            type: 'module-federation',
            remoteEntry: 'https://app.fuzefront.com/apps/clock/assets/remoteEntry.js',
            scope: 'clockApp',
            module: './ClockApp',
        },
        chrome: { menu: 'host', topbar: 'host' },
        routing: { path: '/clock' },
        visibility: 'public',
        roles: [],
    },
];
/**
 * Idempotently provisions the built-in apps as `builtin:true`, `status:activated`
 * (upsert by slug — existing rows are left untouched). Safe to call on every boot.
 * Best-effort: a failure here logs and does NOT abort startup.
 */
async function ensureBuiltins() {
    for (const raw of BUILTIN_MANIFESTS) {
        try {
            const manifest = manifest_schema_1.appManifestSchema.parse(raw);
            await service_1.appRegistryService.upsertBuiltin(manifest, 'activated', (0, crypto_1.randomBytes)(32).toString('hex'));
        }
        catch (err) {
            console.error('[app-registry] failed to provision built-in app (continuing):', err instanceof Error ? err.message : String(err));
        }
    }
}
//# sourceMappingURL=builtins.js.map