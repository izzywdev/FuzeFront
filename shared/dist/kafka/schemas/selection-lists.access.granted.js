"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectionListsAccessGrantedSchemaV1 = void 0;
const zod_1 = require("zod");
const selection_lists_common_1 = require("./selection-lists.common");
/**
 * `selection-lists.access.granted` — a user now holds `role` on one list
 * instance (written to the Security API first, then mirrored). A role CHANGE
 * is a grant with `previousRole` set. Informational only: authorization stays
 * with the Security API / Permit — never authorize from this event.
 */
exports.selectionListsAccessGrantedSchemaV1 = zod_1.z.object({
    eventId: selection_lists_common_1.slEventIdV1,
    organizationId: selection_lists_common_1.slOrganizationIdV1,
    actor: selection_lists_common_1.slActorV1,
    listId: selection_lists_common_1.slListIdV1,
    listKey: selection_lists_common_1.slListKeyV1,
    /** The grantee. */
    userId: selection_lists_common_1.slUserIdV1,
    role: selection_lists_common_1.slRoleV1,
    previousRole: selection_lists_common_1.slRoleV1.nullable(),
});
