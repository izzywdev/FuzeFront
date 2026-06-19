"use strict";
// @fuzefront/core — shared backend bootstrap utilities. Pure config, types,
// auth middleware, and express boilerplate. ZERO business logic. All arrows
// point inward: services depend on core, core never depends on a service.
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
__exportStar(require("./config/database"), exports);
__exportStar(require("./middleware/auth"), exports);
__exportStar(require("./types/shared"), exports);
__exportStar(require("./bootstrap"), exports);
//# sourceMappingURL=index.js.map