import { HashRouter, Routes, Route } from 'react-router-dom'
import { Home } from './pages/Home'
import { Screenshot } from './pages/Screenshot'
import { Pin } from './pages/Pin'

function App(): React.JSX.Element {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/screenshot" element={<Screenshot />} />
        <Route path="/pin" element={<Pin />} />
      </Routes>
    </HashRouter>
  )
}

export default App
