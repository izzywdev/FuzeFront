"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireRole = exports.authenticateToken = void 0;
// Thin re-export shim. JWT auth middleware now lives in @fuzefront/core. Copied
// domain modules import `../middleware/auth` unchanged; this shim forwards to core.
var core_1 = require("@fuzefront/core");
Object.defineProperty(exports, "authenticateToken", { enumerable: true, get: function () { return core_1.authenticateToken; } });
Object.defineProperty(exports, "requireRole", { enumerable: true, get: function () { return core_1.requireRole; } });
//# sourceMappingURL=auth.js.map