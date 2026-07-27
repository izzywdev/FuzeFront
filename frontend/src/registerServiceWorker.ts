// Registers the PWA service worker and — critically — keeps it checking for
// updates for the lifetime of a long-lived SPA tab.
//
// Bug this fixes: with only the auto-injected `registerSW.js` (the default
// when VitePWA has no custom registration), the browser only re-fetches
// sw.js on a hard navigation or its own ~24h heuristic. FuzeFront is a
// client-routed SPA that users often leave open in a tab for a full
// workday, so a deploy could go unnoticed for a day even though
// `registerType: 'autoUpdate'` + `skipWaiting`/`clientsClaim` (vite.config.ts)
// are configured correctly — those only take effect once the browser
// actually re-fetches sw.js and finds it changed.
//
// Fix: explicitly poll `registration.update()` on an interval, and also
// whenever the tab regains focus or the network comes back online — the
// moments a user is most likely to be looking at a stale page. Because
// skipWaiting + clientsClaim are already set, an update found this way
// activates and takes over silently; there is no user-facing "reload?"
// prompt because the SW does not own any client-side state that a swap
// would lose (it's a scoped-network shell/asset cache — see workbox
// runtimeCaching in vite.config.ts, NetworkFirst for JS, NetworkOnly for
// /api). A future feature that keeps meaningful unsaved state across a
// SW swap should revisit this call and surface a DS-driven "update
// available" toast instead of updating silently.
import { registerSW } from 'virtual:pwa-register'

// Tunable via env so tests/local dev aren't forced onto a 60s loop; defaults
// to 60s in all other environments per the fix requirement.
const UPDATE_CHECK_INTERVAL_MS = Number(
  import.meta.env.VITE_SW_UPDATE_INTERVAL_MS ?? 60_000
)

export function registerServiceWorker(): void {
  // VitePWA fully disables the plugin when CI==='true' (vite.config.ts) and
  // `virtual:pwa-register` is only generated when the plugin is active, so
  // guard for non-PWA builds (also covers SSR/non-browser execution).
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return
  }

  let updateSW: (() => Promise<void>) | undefined

  try {
    updateSW = registerSW({
      immediate: true,
      onRegisteredSW(_swUrl, registration) {
        if (!registration) return

        const checkForUpdate = () => {
          registration.update().catch(() => {
            // Transient network/offline failures are expected; the next
            // interval/visibility/online tick will retry.
          })
        }

        window.setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS)

        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') checkForUpdate()
        })

        window.addEventListener('online', checkForUpdate)
      },
      onRegisterError(error) {
        console.error('Service worker registration failed:', error)
      },
    })
  } catch {
    // registerSW throws if invoked outside a context where the plugin
    // generated the virtual module (e.g. VitePWA disabled in CI). Fail
    // silently — the app must run fine with no service worker at all.
    return
  }

  void updateSW
}
