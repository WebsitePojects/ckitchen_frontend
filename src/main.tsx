import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Self-hosted fonts (the CSP allows no third-party font hosts).
import '@fontsource-variable/hanken-grotesk'
import '@fontsource/instrument-serif/400.css'
import '@fontsource/instrument-serif/400-italic.css'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
