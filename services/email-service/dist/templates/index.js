"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderTemplate = void 0;
const welcome_1 = require("./welcome");
const org_invite_1 = require("./org-invite");
const membership_change_1 = require("./membership-change");
const renderers = {
    welcome: welcome_1.renderWelcome,
    'org-invite': org_invite_1.renderOrgInvite,
    'membership-change': membership_change_1.renderMembershipChange,
};
function renderTemplate(name, vars) {
    const renderer = renderers[name];
    if (!renderer) {
        throw new Error(`Unknown template: ${name}`);
    }
    return renderer(vars);
}
exports.renderTemplate = renderTemplate;
//# sourceMappingURL=index.js.map