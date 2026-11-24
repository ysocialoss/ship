import { Alignment, Card, Classes, H1, Navbar, NavbarGroup, NavbarHeading, Switch } from '@blueprintjs/core'
import { useState, useSyncExternalStore } from 'react'
import './App.css'

const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')

function subscribeToSystemTheme(onChange: () => void) {
  systemTheme.addEventListener('change', onChange)
  return () => systemTheme.removeEventListener('change', onChange)
}

function getSystemDarkMode() {
  return systemTheme.matches
}

function App() {
  const systemDarkMode = useSyncExternalStore(subscribeToSystemTheme, getSystemDarkMode)
  const [themeOverride, setThemeOverride] = useState<boolean | null>(null)
  const darkMode = themeOverride ?? systemDarkMode

  return (
    <div className={darkMode ? `app-shell ${Classes.DARK}` : 'app-shell'}>
      <Navbar>
        <NavbarGroup align={Alignment.LEFT}>
          <NavbarHeading>Ship</NavbarHeading>
        </NavbarGroup>
        <NavbarGroup align={Alignment.RIGHT}>
          <Switch
            inline
            label="Dark mode"
            checked={darkMode}
            onChange={(event) => setThemeOverride(event.currentTarget.checked)}
          />
        </NavbarGroup>
      </Navbar>
      <main>
        <Card>
          <H1>Workspace</H1>
        </Card>
      </main>
    </div>
  )
}

export default App
