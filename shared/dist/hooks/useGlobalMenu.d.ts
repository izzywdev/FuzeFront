import { MenuItem } from '../types';
export declare function useGlobalMenu(): {
    menuItems: MenuItem[];
    portalMenuItems: MenuItem[];
    appMenuItems: MenuItem[];
    setMenuItems: (items: MenuItem[]) => void;
    addMenuItem: (item: MenuItem) => void;
    removeMenuItem: (id: string) => void;
    addAppMenuItems: (appId: string, items: MenuItem[]) => void;
    removeAppMenuItems: (appId: string) => void;
    clearAllAppMenuItems: () => void;
};
