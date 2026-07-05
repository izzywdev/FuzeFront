import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
  // Reset document direction/lang between tests so RTL assertions are isolated.
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.removeAttribute('dir')
    document.documentElement.removeAttribute('lang')
  }
  try {
    localStorage.clear()
  } catch {
    /* ignore */
  }
})
