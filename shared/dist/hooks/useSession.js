import { useAppContext } from '../context/AppContext';
export function useSession() {
    var _a;
    const { state, dispatch } = useAppContext();
    const setSession = (session) => {
        dispatch({ type: 'SET_SESSION', payload: session });
    };
    return {
        session: state.session,
        setSession,
        tenantId: ((_a = state.session) === null || _a === void 0 ? void 0 : _a.tenantId) || null,
    };
}
