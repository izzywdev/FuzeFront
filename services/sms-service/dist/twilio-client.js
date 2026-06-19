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
    return (0, twilio_1.default)(cfg.accountSid, cfg.authToken);
}
exports.createTwilioClient = createTwilioClient;
//# sourceMappingURL=twilio-client.js.map