"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.identityOrgUpdatedSchemaV1 = void 0;
const identity_org_created_1 = require("./identity.org.created");
/**
 * Emitted when an organization's mutable fields (name, slug, settings,
 * metadata) change. Carries the full post-update snapshot so consumers can
 * re-seed idempotently — see `organizationSnapshotV1`.
 */
exports.identityOrgUpdatedSchemaV1 = identity_org_created_1.organizationSnapshotV1;
