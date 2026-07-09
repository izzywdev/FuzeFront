import { useEffect, useRef, useState } from 'react'
import {
  getPlatformContext,
  subscribeContext,
  notify,
  PlatformSnapshot,
} from './sdk'
import './index.css'

// This is the module the host loads at runtime (exposed as './App').
export default function App() {
  const [now, setNow] = useState(() => new Date())
  const [ctx, setCtx] = useState<PlatformSnapshot>(() => getPlatformContext())
  const greeted = useRef(false)

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  // Live host context via the bridge (user, apps, etc.).
  useEffect(() => subscribeContext(setCtx), [])

  // Greet the host through the shared toaster, once, when mounted in-platform.
  useEffect(() => {
    if (ctx.isPlatformMode && !greeted.current) {
      greeted.current = true
      notify({
        title: 'FuzeClock',
        message: 'Loaded at runtime and connected to the host bridge 👋',
        level: 'success',
        appId: 'clock',
      })
    }
  }, [ctx.isPlatformMode])

  return (
    <div className="fuzeclock">
      <h2>🕒 FuzeClock</h2>
      <div className="time">{now.toLocaleTimeString()}</div>
      <div className="date">
        {now.toLocaleDateString(undefined, {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })}
      </div>
      <p className="note">
        Loaded at runtime via Module Federation. No build-time knowledge of the
        host — only the SDK / <code>window.__FUZEFRONT__</code> bridge.
      </p>
      <ul className="ctx">
        <li>
          Mounted inside FuzeFront:{' '}
          <b>{ctx.isPlatformMode ? 'yes' : 'no (standalone)'}</b>
        </li>
        <li>
          User (live from host): <b>{ctx.user?.email ?? '—'}</b>
        </li>
        <li>
          Apps known to host: <b>{ctx.apps.length}</b>
        </li>
      </ul>
      <button
        className="btn"
        onClick={() =>
          notify({
            title: 'FuzeClock',
            message: `Hello from the clock at ${new Date().toLocaleTimeString()}`,
            level: 'info',
            appId: 'clock',
          })
        }
      >
        Send a toast to the host
      </button>
    </div>
  )
}
