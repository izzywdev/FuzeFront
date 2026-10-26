"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.portalCreatedSchemaV1 = void 0;
const zod_1 = require("zod");
/**
 * FF-EPIC-09-S2 — emitted once the resumable portal provisioning pipeline has
 * finished every infrastructure step (org, Permit tenant, portal row, default
 * subdomain) and attempted the owner invite — REGARDLESS of whether the
 * invite dispatch itself succeeded (AC4: a failed invite still leaves the
 * portal `provisioned-pending-invite` and still emits this event, so a
 * downstream consumer can retry the notification independently of the
 * synchronous create-portal HTTP response).
 */
exports.portalCreatedSchemaV1 = zod_1.z.object({
    portalId: zod_1.z.string(),
    slug: zod_1.z.string(),
    organizationId: zod_1.z.string().uuid(),
    ownerEmail: zod_1.z.string().email(),
    status: zod_1.z.enum(['provisioning', 'provisioned-pending-invite', 'active', 'suspended']),
});
