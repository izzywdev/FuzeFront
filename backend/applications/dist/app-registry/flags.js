"use strict";
// Feature-flag access for the app-registry slice. Reads flags via the family
// OpenFeature client (`@fuzefront/feature-flags`) per the feature-flags skill —
// we CONSUME flags here; the flag platform/taxonomy is owned by
// feature-flags-engineer.
//
// Flags used by this slice (owner: backend-engineer / app-registry):
//   - fuzefront.app-registry.v1-registry-write
//       type: release | default: OFF
//       gates the NEW versioned write paths (register/update/delete/activate/
//       suspend) so the contract surface can merge dark and be released
//       deliberately. Read GETs are NOT gated (safe to expose).
//       removal criterion: delete once /api/v1/app-registry is 100% rolled out
//       and stable; then drop the flag + the off-path 503 branch.
//   - fuzefront.app-registry.kafka-events-kill-switch
//       type: ops-kill-switch | default: ON
//       circuit-breaker for emitting Kafka events on the registry write path
//       (the expensive/risky async fan-out). Flip OFF to stop emitting without a
//       redeploy. removal criterion: only if Kafka emission is removed.
//
// The in-code default is the fail-safe value (OFF for release, ON for
// kill-switch) so an Unleash/client outage fails safe. The client is resolved
// lazily and any error → the default, so a missing client never breaks a request.
Object.defineProperty(exports, "__esModule", { value: true });
exports.FLAGS = void 0;
exports.setFlagClient = setFlagClient;
exports.isV1WriteEnabled = isV1WriteEnabled;
exports.isKafkaEmitEnabled = isKafkaEmitEnabled;
exports.FLAGS = {
    V1_REGISTRY_WRITE: 'fuzefront.app-registry.v1-registry-write',
    KAFKA_EVENTS_KILL_SWITCH: 'fuzefront.app-registry.kafka-events-kill-switch',
};
let injected = null;
/** Test/DI seam — pin flag values with an in-memory client. */
function setFlagClient(c) {
    injected = c;
}
function resolveClient() {
    if (injected)
        return injected;
    try {
        // Lazy require so the service does not hard-require the client where the
        // family flag platform is not yet wired; absence → null → safe defaults.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require('@fuzefront/feature-flags');
        const client = typeof mod.getClient === 'function' ? mod.getClient() : null;
        return client;
    }
    catch {
        return null;
    }
}
function buildContext(ctx) {
    return {
        environment: process.env.NODE_ENV === 'production' ? 'prod' : process.env.FLAG_ENV || 'local',
        app: 'applications-service',
        ...ctx,
    };
}
/**
 * release flag (default OFF): is the new /api/v1/app-registry WRITE surface
 * released for this caller/org? Pass the request context so rollout can target
 * by org/user.
 */
async function isV1WriteEnabled(ctx) {
    const client = resolveClient();
    if (!client)
        return false; // fail-safe: release default OFF
    try {
        return await client.getBooleanValue(exports.FLAGS.V1_REGISTRY_WRITE, false, buildContext(ctx));
    }
    catch {
        return false;
    }
}
/**
 * ops-kill-switch (default ON): may we emit Kafka events on the write path?
 * Returns true (emit) unless explicitly killed.
 */
async function isKafkaEmitEnabled(ctx) {
    const client = resolveClient();
    if (!client)
        return true; // fail-safe: kill-switch default ON
    try {
        return await client.getBooleanValue(exports.FLAGS.KAFKA_EVENTS_KILL_SWITCH, true, buildContext(ctx));
    }
    catch {
        return true;
    }
}
//# sourceMappingURL=flags.js.map