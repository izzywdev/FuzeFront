"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTwilioClient = exports.createMockTwilioClient = void 0;
const twilio_1 = __importDefault(require("twilio"));
/**
 * Mock Twilio client for CI / inert mode.
 * send always returns status "pending"; check returns "approved" only for code "000000".
 */
function createMockTwilioClient() {
    return {
        verify: {
            v2: {
                services(_sid) {
                    return {
                        verifications: {
                            async create(_opts) {
                                return { status: 'pending' };
                            },
                        },
                        verificationChecks: {
                            async create(opts) {
                                return { status: opts.code === '000000' ? 'approved' : 'pending' };
                            },
                        },
                    };
                },
            },
        },
    };
}
exports.createMockTwilioClient = createMockTwilioClient;
function createTwilioClient(cfg) {
    if (cfg.mock) {
        return createMockTwilioClient();
    }
    // Prefer API Key auth (SK… SID + secret, scoped to the account) — Twilio's
    // recommended credential, revocable without rotating the account Auth Token.
    // Fall back to legacy account-token auth when no API key is configured.
    const client = cfg.apiKeySid
        ? (0, twilio_1.default)(cfg.apiKeySid, cfg.apiKeySecret, { accountSid: cfg.accountSid })
        : (0, twilio_1.default)(cfg.accountSid, cfg.authToken);
    // Verify the SDK object exposes the Verify v2 namespace before casting.
    // The twilio SDK typings are looser than our internal interface, so we do a
    // runtime check here to surface mis-configuration (wrong SDK version, etc.)
    // rather than a cryptic runtime error deep in the request path.
    if (!client.verify?.v2) {
        throw new Error('Twilio client does not expose verify.v2 — check twilio SDK version');
    }
    return client;
}
exports.createTwilioClient = createTwilioClient;
//# sourceMappingURL=twilio-client.js.map