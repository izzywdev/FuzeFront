import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { NavBar } from './components/NavBar'
import { HomePage } from './pages/HomePage'
import { CatalogPage } from './pages/CatalogPage'
import { SpecViewerPage } from './pages/SpecViewerPage'
import { PlaygroundPage } from './pages/PlaygroundPage'
import { MyAccessPage } from './pages/MyAccessPage'
import { useAuth } from './hooks'

function App() {
  const auth = useAuth()

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-secondary-50">
        <NavBar auth={auth} onSignedOut={auth.refresh} />
        <Routes>
          <Route path="/" element={<HomePage auth={auth} />} />
          <Route path="/catalog" element={<CatalogPage />} />
          <Route path="/catalog/:repo/:service" element={<SpecViewerPage />} />
          <Route path="/playground" element={<PlaygroundPage />} />
          <Route path="/my-access" element={<MyAccessPage auth={auth} />} />
        </Routes>
      </div>
    </BrowserRouter>
  )
}

export default App
