"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectionListsAccessRevokedSchemaV1 = void 0;
const zod_1 = require("zod");
const selection_lists_common_1 = require("./selection-lists.common");
/** `selection-lists.access.revoked` — the user no longer holds any role on the list. */
exports.selectionListsAccessRevokedSchemaV1 = zod_1.z.object({
    eventId: selection_lists_common_1.slEventIdV1,
    organizationId: selection_lists_common_1.slOrganizationIdV1,
    actor: selection_lists_common_1.slActorV1,
    listId: selection_lists_common_1.slListIdV1,
    listKey: selection_lists_common_1.slListKeyV1,
    /** The user whose grant was removed. */
    userId: selection_lists_common_1.slUserIdV1,
    /** The role that was revoked. */
    role: selection_lists_common_1.slRoleV1,
});
