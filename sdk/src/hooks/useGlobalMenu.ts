import { useCallback } from 'react'
import { usePlatformContext } from '../context/PlatformProvider'
import type { UseGlobalMenuResult, MenuItem } from '../types'

export function useGlobalMenu(): UseGlobalMenuResult {
  const { state, dispatch } = usePlatformContext()

  const setMenuItems = useCallback(
    (items: MenuItem[]) => {
      dispatch({ type: 'SET_MENU_ITEMS', payload: items })
    },
    [dispatch]
  )

  const addMenuItem = useCallback(
    (item: MenuItem) => {
      const newItems = [...state.menuItems]

      // Insert before 'help' which should always be last
      const helpIndex = newItems.findIndex(i => i.id === 'help')
      if (helpIndex > -1) {
        newItems.splice(helpIndex, 0, item)
      } else {
        newItems.push(item)
      }

      setMenuItems(newItems)
    },
    [state.menuItems, setMenuItems]
  )

  const removeMenuItem = useCallback(
    (id: string) => {
      const newItems = state.menuItems.filter(item => item.id !== id)
      setMenuItems(newItems)
    },
    [state.menuItems, setMenuItems]
  )

  const updateMenuItem = useCallback(
    (id: string, updates: Partial<MenuItem>) => {
      const newItems = state.menuItems.map(item =>
        item.id === id ? { ...item, ...updates } : item
      )
      setMenuItems(newItems)
    },
    [state.menuItems, setMenuItems]
  )

  return {
    menuItems: state.menuItems,
    setMenuItems,
    addMenuItem,
    removeMenuItem,
    updateMenuItem,
  }
}
