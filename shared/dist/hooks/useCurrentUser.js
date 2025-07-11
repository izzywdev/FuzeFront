import { useAppContext } from '../context/AppContext';
export function useCurrentUser() {
    const { state, dispatch } = useAppContext();
    const setUser = (user) => {
        dispatch({ type: 'SET_USER', payload: user });
    };
    return {
        user: state.user,
        setUser,
        isAuthenticated: !!state.user,
    };
}
