"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.useSession = useSession;
const AppContext_1 = require("../context/AppContext");
function useSession() {
    var _a;
    const { state, dispatch } = (0, AppContext_1.useAppContext)();
    const setSession = (session) => {
        dispatch({ type: 'SET_SESSION', payload: session });
    };
    return {
        session: state.session,
        setSession,
        tenantId: ((_a = state.session) === null || _a === void 0 ? void 0 : _a.tenantId) || null,
    };
}
