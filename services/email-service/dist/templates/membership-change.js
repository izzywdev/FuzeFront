"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderMembershipChange = void 0;
const html_1 = require("../utils/html");
/** Known membership actions that may appear in a rendered email. */
const KNOWN_ACTIONS = new Set(['added', 'removed', 'updated', 'promoted', 'demoted']);
/** Known membership roles that may appear in a rendered email. */
const KNOWN_ROLES = new Set(['owner', 'admin', 'member', 'viewer', 'guest']);
/**
 * Narrow an action string to a known value.
 * Falls back to 'updated' for any unrecognised value so the email is still
 * useful while not leaking arbitrary attacker-controlled strings into HTML.
 */
function narrowAction(raw) {
    return KNOWN_ACTIONS.has(raw) ? raw : 'updated';
}
/**
 * Narrow a role string to a known value.
 * Falls back to 'member' for any unrecognised value.
 */
function narrowRole(raw) {
    return KNOWN_ROLES.has(raw) ? raw : 'member';
}
function renderMembershipChange(vars) {
    const orgName = String(vars.orgName || 'your organization');
    const action = narrowAction(String(vars.action || 'updated'));
    const role = narrowRole(String(vars.role || 'member'));
    const safeOrgName = (0, html_1.escapeHtml)(orgName);
    const safeAction = (0, html_1.escapeHtml)(action);
    const safeRole = (0, html_1.escapeHtml)(role);
    return {
        subject: `Your membership in ${safeOrgName} has been ${safeAction}`,
        html: `<p>Your membership in <strong>${safeOrgName}</strong> has been <strong>${safeAction}</strong>. Your role is <strong>${safeRole}</strong>.</p>`,
        text: `Your membership in ${orgName} has been ${action}. Your role is ${role}.`,
    };
}
exports.renderMembershipChange = renderMembershipChange;
//# sourceMappingURL=membership-change.js.map