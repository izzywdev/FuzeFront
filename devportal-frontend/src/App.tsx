import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { PortalTopBar } from './components/PortalTopBar'
import { DevPortalHomeFlow } from './pages/home/DevPortalHomeFlow'
import { SpecCatalogFlow } from './pages/catalog/SpecCatalogFlow'
import { SpecViewerFlow } from './pages/spec/SpecViewerFlow'
import { PlaygroundFlow } from './pages/playground/PlaygroundFlow'
import { MyAccessFlow } from './pages/access/MyAccessFlow'
import { useMyAccess } from './hooks'

// NOTE — route contract fix (per design/frames/devportal/manifest.json
// build.flows[id=my-access].route): the approved frame wires "My access" at
// `/access`. The prior stub wired it at `/my-access` — re-pointed here per the
// design-first gate (the approved frame's route is the frozen contract, not
// whatever the scaffold guessed). `/my-access` is intentionally NOT kept as an
// alias: a silent redirect would let a stale bookmark paper over the mismatch
// instead of surfacing it.
function App() {
  const auth = useMyAccess()

  return (
    <BrowserRouter>
      <div className="dp-shell">
        <PortalTopBar auth={auth} />
        <main className="dp-main">
          <Routes>
            <Route path="/" element={<DevPortalHomeFlow auth={auth} />} />
            <Route path="/catalog" element={<SpecCatalogFlow />} />
            <Route path="/catalog/:repo/:service" element={<SpecViewerFlow />} />
            <Route path="/playground" element={<PlaygroundFlow />} />
            <Route path="/access" element={<MyAccessFlow auth={auth} />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}

export default App
