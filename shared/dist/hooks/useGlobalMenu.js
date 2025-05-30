import { useAppContext } from '../context/AppContext'
export function useGlobalMenu() {
  const { state, dispatch } = useAppContext()
  const setMenuItems = items => {
    dispatch({ type: 'SET_MENU_ITEMS', payload: items })
  }
  const addMenuItem = item => {
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
  const removeMenuItem = id => {
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
