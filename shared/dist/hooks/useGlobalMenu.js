import { useAppContext } from '../context/AppContext';
export function useGlobalMenu() {
    const { state, dispatch } = useAppContext();
    const portalMenuItems = state.menuItems
        .filter(item => item.category === 'portal' || !item.category)
        .sort((a, b) => (a.order || 0) - (b.order || 0));
    const appMenuItems = state.menuItems
        .filter(item => item.category === 'app')
        .sort((a, b) => (a.order || 0) - (b.order || 0));
    const setMenuItems = (items) => {
        dispatch({ type: 'SET_MENU_ITEMS', payload: items });
    };
    const addMenuItem = (item) => {
        const newItems = [...state.menuItems];
        // Insert before 'help' which should always be last for portal items
        if (item.category === 'portal' || !item.category) {
            const helpIndex = newItems.findIndex(i => i.id === 'help');
            if (helpIndex > -1) {
                newItems.splice(helpIndex, 0, item);
            }
            else {
                newItems.push(item);
            }
        }
        else {
            // App items go after portal items
            newItems.push(item);
        }
        setMenuItems(newItems);
    };
    const removeMenuItem = (id) => {
        const newItems = state.menuItems.filter(item => item.id !== id);
        setMenuItems(newItems);
    };
    const addAppMenuItems = (appId, items) => {
        // Mark items as app-specific and add appId
        const appMenuItems = items.map(item => (Object.assign(Object.assign({}, item), { category: 'app', appId })));
        dispatch({
            type: 'ADD_APP_MENU_ITEMS',
            payload: { appId, items: appMenuItems },
        });
    };
    const removeAppMenuItems = (appId) => {
        dispatch({ type: 'REMOVE_APP_MENU_ITEMS', payload: appId });
    };
    const clearAllAppMenuItems = () => {
        dispatch({ type: 'CLEAR_ALL_APP_MENU_ITEMS' });
    };
    return {
        menuItems: state.menuItems,
        portalMenuItems,
        appMenuItems,
        setMenuItems,
        addMenuItem,
        removeMenuItem,
        addAppMenuItems,
        removeAppMenuItems,
        clearAllAppMenuItems,
    };
}
