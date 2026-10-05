"use strict";
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
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppProvider = AppProvider;
exports.useAppContext = useAppContext;
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = __importStar(require("react"));
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
