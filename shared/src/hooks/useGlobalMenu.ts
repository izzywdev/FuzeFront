import { useAppContext } from '../context/AppContext'
import { MenuItem } from '../types'

export function useGlobalMenu(): {
  menuItems: MenuItem[]
  setMenuItems: (items: MenuItem[]) => void
  addMenuItem: (item: MenuItem) => void
  removeMenuItem: (id: string) => void
} {
  const { state, dispatch } = useAppContext()

  const setMenuItems = (items: MenuItem[]) => {
    dispatch({ type: 'SET_MENU_ITEMS', payload: items })
  }

  const addMenuItem = (item: MenuItem) => {
    const newItems = [...state.menuItems]
    // Insert before 'help' which should always be last
    const helpIndex = newItems.findIndex(i => i.id === 'help')
    if (helpIndex > -1) {
      newItems.splice(helpIndex, 0, item)
    } else {
      newItems.push(item)
    }
    setMenuItems(newItems)
  }

  const removeMenuItem = (id: string) => {
    const newItems = state.menuItems.filter(item => item.id !== id)
    setMenuItems(newItems)
  }

  return {
    menuItems: state.menuItems,
    setMenuItems,
    addMenuItem,
    removeMenuItem,
  }
}
