import { useAppContext } from '../context/AppContext'
import { MenuItem } from '../types'

export function useGlobalMenu(): {
  menuItems: MenuItem[]
  portalMenuItems: MenuItem[]
  appMenuItems: MenuItem[]
  setMenuItems: (items: MenuItem[]) => void
  addMenuItem: (item: MenuItem) => void
  removeMenuItem: (id: string) => void
  addAppMenuItems: (appId: string, items: MenuItem[]) => void
  removeAppMenuItems: (appId: string) => void
  clearAllAppMenuItems: () => void
} {
  const { state, dispatch } = useAppContext()

  const portalMenuItems = state.menuItems
    .filter(item => item.category === 'portal' || !item.category)
    .sort((a, b) => (a.order || 0) - (b.order || 0))

  const appMenuItems = state.menuItems
    .filter(item => item.category === 'app')
    .sort((a, b) => (a.order || 0) - (b.order || 0))

  const setMenuItems = (items: MenuItem[]) => {
    dispatch({ type: 'SET_MENU_ITEMS', payload: items })
  }

  const addMenuItem = (item: MenuItem) => {
    const newItems = [...state.menuItems]
    // Insert before 'help' which should always be last for portal items
    if (item.category === 'portal' || !item.category) {
      const helpIndex = newItems.findIndex(i => i.id === 'help')
      if (helpIndex > -1) {
        newItems.splice(helpIndex, 0, item)
      } else {
        newItems.push(item)
      }
    } else {
      // App items go after portal items
      newItems.push(item)
    }
    setMenuItems(newItems)
  }

  const removeMenuItem = (id: string) => {
    const newItems = state.menuItems.filter(item => item.id !== id)
    setMenuItems(newItems)
  }

  const addAppMenuItems = (appId: string, items: MenuItem[]) => {
    // Mark items as app-specific and add appId
    const appMenuItems = items.map(item => ({
      ...item,
      category: 'app' as const,
      appId,
    }))
    dispatch({
      type: 'ADD_APP_MENU_ITEMS',
      payload: { appId, items: appMenuItems },
    })
  }

  const removeAppMenuItems = (appId: string) => {
    dispatch({ type: 'REMOVE_APP_MENU_ITEMS', payload: appId })
  }

  const clearAllAppMenuItems = () => {
    dispatch({ type: 'CLEAR_ALL_APP_MENU_ITEMS' })
  }

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
  }
}
