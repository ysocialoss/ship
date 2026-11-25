import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'normalize.css/normalize.css'
import '@blueprintjs/core/lib/css/blueprint.css'
import '@blueprintjs/datetime/lib/css/blueprint-datetime.css'
import '@blueprintjs/select/lib/css/blueprint-select.css'
import '@fontsource-variable/inter/index.css'
import './theme.css'
import { Root } from './Root.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
