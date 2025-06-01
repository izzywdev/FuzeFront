import { useCallback } from 'react'
import { usePlatformContext } from '../context/PlatformProvider'
import type { UseGlobalMenuResult, MenuItem } from '../types'

export function useGlobalMenu(): UseGlobalMenuResult {
  const { state, dispatch } = usePlatformContext()

  const portalMenuItems = state.menuItems
    .filter(item => item.category === 'portal' || !item.category)
    .sort((a, b) => (a.order || 0) - (b.order || 0))

  const appMenuItems = state.menuItems
    .filter(item => item.category === 'app')
    .sort((a, b) => (a.order || 0) - (b.order || 0))

  const setMenuItems = useCallback(
    (items: MenuItem[]) => {
      dispatch({ type: 'SET_MENU_ITEMS', payload: items })
    },
    [dispatch]
  )

  const addMenuItem = useCallback(
    (item: MenuItem) => {
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

  const addAppMenuItems = useCallback(
    (appId: string, items: MenuItem[]) => {
      // Mark items as app-specific and add appId
      const appMenuItems = items.map(item => ({
        ...item,
        category: 'app' as const,
        appId,
      }))

      // Add to existing menu items
      const newItems = [...state.menuItems, ...appMenuItems]
      setMenuItems(newItems)
    },
    [state.menuItems, setMenuItems]
  )

  const removeAppMenuItems = useCallback(
    (appId: string) => {
      const newItems = state.menuItems.filter(item => item.appId !== appId)
      setMenuItems(newItems)
    },
    [state.menuItems, setMenuItems]
  )

  const clearAllAppMenuItems = useCallback(() => {
    const newItems = state.menuItems.filter(
      item => item.category === 'portal' || !item.category
    )
    setMenuItems(newItems)
  }, [state.menuItems, setMenuItems])

  return {
    menuItems: state.menuItems,
    portalMenuItems,
    appMenuItems,
    setMenuItems,
    addMenuItem,
    removeMenuItem,
    updateMenuItem,
    addAppMenuItems,
    removeAppMenuItems,
    clearAllAppMenuItems,
  }
}
