import { MenuItem } from '../types'
export declare function useGlobalMenu(): {
  menuItems: MenuItem[]
  setMenuItems: (items: MenuItem[]) => void
  addMenuItem: (item: MenuItem) => void
  removeMenuItem: (id: string) => void
}
