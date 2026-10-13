"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppProvider = AppProvider;
exports.useAppContext = useAppContext;
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = require("react");
const initialState = {
    user: null,
    session: null,
    apps: [],
    activeApp: null,
    menuItems: [
        {
            id: 'dashboard',
            label: 'Dashboard',
            icon: '🏠',
            route: '/dashboard',
            category: 'portal',
            order: 1,
        },
        {
            id: 'help',
            label: 'Help',
            icon: '❓',
            route: '/help',
            category: 'portal',
            order: 999, // Keep help at the bottom
        },
    ],
    isLoading: false,
};
function appReducer(state, action) {
    switch (action.type) {
        case 'SET_USER':
            return Object.assign(Object.assign({}, state), { user: action.payload });
        case 'SET_SESSION':
            return Object.assign(Object.assign({}, state), { session: action.payload });
        case 'SET_APPS':
            return Object.assign(Object.assign({}, state), { apps: action.payload });
        case 'ADD_APP':
            // Check if app already exists to avoid duplicates
            const existingApp = state.apps.find(app => app.id === action.payload.id);
            if (existingApp) {
                return state;
            }
            return Object.assign(Object.assign({}, state), { apps: [...state.apps, action.payload] });
        case 'SET_ACTIVE_APP':
            return Object.assign(Object.assign({}, state), { activeApp: action.payload });
        case 'SET_MENU_ITEMS':
            return Object.assign(Object.assign({}, state), { menuItems: action.payload });
        case 'ADD_APP_MENU_ITEMS':
            return Object.assign(Object.assign({}, state), { menuItems: [...state.menuItems, ...action.payload.items] });
        case 'REMOVE_APP_MENU_ITEMS':
            return Object.assign(Object.assign({}, state), { menuItems: state.menuItems.filter(item => item.appId !== action.payload) });
        case 'CLEAR_ALL_APP_MENU_ITEMS':
            return Object.assign(Object.assign({}, state), { menuItems: state.menuItems.filter(item => item.category === 'portal') });
        case 'SET_LOADING':
            return Object.assign(Object.assign({}, state), { isLoading: action.payload });
        case 'UPDATE_APP_STATUS':
            return Object.assign(Object.assign({}, state), { apps: state.apps.map(app => app.id === action.payload.appId
                    ? Object.assign(Object.assign({}, app), { isHealthy: action.payload.isHealthy }) : app) });
        default:
            return state;
    }
}
const AppContext = (0, react_1.createContext)(null);
function AppProvider({ children }) {
    const [state, dispatch] = (0, react_1.useReducer)(appReducer, initialState);
    return ((0, jsx_runtime_1.jsx)(AppContext.Provider, { value: { state, dispatch }, children: children }));
}
function useAppContext() {
    const context = (0, react_1.useContext)(AppContext);
    if (!context) {
        throw new Error('useAppContext must be used within an AppProvider');
    }
    return context;
}
