"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.useCurrentUser = useCurrentUser;
const AppContext_1 = require("../context/AppContext");
function useCurrentUser() {
    const { state, dispatch } = (0, AppContext_1.useAppContext)();
    const setUser = (user) => {
        dispatch({ type: 'SET_USER', payload: user });
    };
    return {
        user: state.user,
        setUser,
        isAuthenticated: !!state.user,
    };
}
