"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderWelcome = void 0;
const html_1 = require("../utils/html");
function renderWelcome(vars) {
    const firstName = String(vars.firstName || 'there');
    const loginUrl = String(vars.loginUrl || 'https://app.fuzefront.com');
    const safeFirstName = (0, html_1.escapeHtml)(firstName);
    const safeLoginUrl = (0, html_1.validateAndEscapeUrl)(loginUrl);
    return {
        subject: `Welcome to FuzeFront, ${safeFirstName}!`,
        html: `<h1>Welcome, ${safeFirstName}!</h1><p>Your FuzeFront account is ready.</p><p><a href="${safeLoginUrl}">Log in now</a></p>`,
        text: `Welcome, ${firstName}!\n\nYour FuzeFront account is ready.\n\nLog in: ${loginUrl}`,
    };
}
exports.renderWelcome = renderWelcome;
//# sourceMappingURL=welcome.js.map