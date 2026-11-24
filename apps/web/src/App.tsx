import {
  Alignment, Button, Classes, H1, Icon, Navbar, NavbarGroup, NavbarHeading, Switch,
} from '@blueprintjs/core'
import { useState, useSyncExternalStore } from 'react'
import { Board } from './Board'
import './App.css'

const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
const wideViewport = window.matchMedia('(min-width: 768px)')

function mediaPreference(query: MediaQueryList) {
  return {
    subscribe(onChange: () => void) {
      query.addEventListener('change', onChange)
      return () => query.removeEventListener('change', onChange)
    },
    getSnapshot: () => query.matches,
  }
}

const darkPreference = mediaPreference(systemTheme)
const desktopLayout = mediaPreference(wideViewport)

const sidebarViews = [
  { id: 'work-items', title: 'Work Items', icon: 'layout' },
  { id: 'modules', title: 'Modules', icon: 'layers' },
  { id: 'intake', title: 'Intake', icon: 'inbox' },
] as const

function subscribeToLocation(onChange: () => void) {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

function getActiveView() {
  return sidebarViews.find((view) => '#' + view.id === window.location.hash) ?? sidebarViews[0]
}

function App() {
  const systemDarkMode = useSyncExternalStore(darkPreference.subscribe, darkPreference.getSnapshot)
  const isDesktop = useSyncExternalStore(desktopLayout.subscribe, desktopLayout.getSnapshot)
  const [themeOverride, setThemeOverride] = useState<boolean | null>(null)
  const [sidebarOverride, setSidebarOverride] = useState<boolean | null>(null)
  const darkMode = themeOverride ?? systemDarkMode
  const sidebarOpen = sidebarOverride ?? isDesktop
  const activeView = useSyncExternalStore(subscribeToLocation, getActiveView)

  function dismissMobileSidebar() {
    if (!isDesktop) setSidebarOverride(null)
  }

  return (
    <div className={darkMode ? `app-shell ${Classes.DARK}` : 'app-shell'}>
      <Navbar>
        <NavbarGroup align={Alignment.LEFT}>
          <Button
            className="sidebar-toggle"
            variant="minimal"
            icon="menu"
            aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            aria-expanded={sidebarOpen}
            aria-controls="app-sidebar"
            onClick={() => setSidebarOverride(!sidebarOpen)}
          />
          <NavbarHeading>Ship</NavbarHeading>
        </NavbarGroup>
      </Navbar>
      <div className="workspace-layout">
        <aside className="app-sidebar" id="app-sidebar" hidden={!sidebarOpen}>
          <nav aria-label="Workspace navigation">
            <ul className={Classes.MENU}>
              {sidebarViews.map((view) => (
                <li key={view.id}>
                  <a
                    className={activeView.id === view.id ? Classes.MENU_ITEM + ' ' + Classes.ACTIVE : Classes.MENU_ITEM}
                    href={'#' + view.id}
                    aria-current={activeView.id === view.id ? 'page' : undefined}
                    onClick={dismissMobileSidebar}
                  >
                    <Icon icon={view.icon} aria-hidden="true" />
                    <span>{view.title}</span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="sidebar-footer">
            <Switch
              label="Dark mode"
              checked={darkMode}
              onChange={(event) => setThemeOverride(event.currentTarget.checked)}
            />
          </div>
        </aside>
        {activeView.id === 'work-items' ? (
          <Board />
        ) : (
          <main className="workspace-view">
            <H1 id={activeView.id}>{activeView.title}</H1>
            <p>{activeView.id === 'modules' ? 'No modules yet.' : 'No intake items yet.'}</p>
          </main>
        )}
      </div>
    </div>
  )
}

export default App
