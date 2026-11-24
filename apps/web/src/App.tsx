import {
  Alignment, Button, Classes, Dialog, DialogBody, H1, Icon,
  Menu, MenuDivider, MenuItem, Navbar, NavbarGroup, NavbarHeading, PopoverNext,
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

const appearanceOptions = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
] as const

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
  const [sidebarOverride, setSidebarOverride] = useState<boolean | null>(null)
  const [appearance, setAppearance] = useState<(typeof appearanceOptions)[number]['id']>('system')
  const [profileOpen, setProfileOpen] = useState(false)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const darkMode = appearance === 'system' ? systemDarkMode : appearance === 'dark'
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
            onClick={() => {
              setSidebarOverride(!sidebarOpen)
              setAccountMenuOpen(false)
            }}
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
            <PopoverNext
              className="sidebar-profile"
              fill
              arrow
              placement={isDesktop ? 'top-start' : 'bottom-start'}
              middleware={{ offset: { mainAxis: 10 } }}
              isOpen={accountMenuOpen}
              onInteraction={setAccountMenuOpen}
              renderTarget={(targetProps) => (
                <button
                  {...targetProps}
                  type="button"
                  aria-label="Account options for Full Name"
                  onKeyDown={undefined}
                >
                  <span className="sidebar-avatar">
                    <Icon icon="person" size={16} aria-hidden="true" />
                  </span>
                  <span className="sidebar-profile-details">
                    <span className="sidebar-profile-name">Full Name</span>
                    <span className={Classes.TEXT_MUTED}>@username</span>
                  </span>
                  <Icon className="sidebar-profile-chevron" icon="chevron-down" size={12} aria-hidden="true" />
                </button>
              )}
              content={
                <Menu aria-label="Account options">
                  <MenuItem
                    icon="user"
                    text="Profile"
                    onClick={() => {
                      setAccountMenuOpen(false)
                      setProfileOpen(true)
                    }}
                  />
                  <MenuDivider title="Appearance" />
                  {appearanceOptions.map((option) => (
                    <MenuItem
                      key={option.id}
                      icon={appearance === option.id ? 'tick' : 'blank'}
                      roleStructure="menuitem"
                      role="menuitemradio"
                      aria-checked={appearance === option.id}
                      text={option.label}
                      onClick={() => setAppearance(option.id)}
                    />
                  ))}
                  <MenuDivider />
                  <MenuItem icon="log-out" text="Log out" disabled />
                </Menu>
              }
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
      <Dialog isOpen={profileOpen} onClose={() => setProfileOpen(false)} title="Profile" usePortal={false}>
        <DialogBody>
          <p><strong>Full Name</strong></p>
          <p className={Classes.TEXT_MUTED}>@username</p>
        </DialogBody>
      </Dialog>
    </div>
  )
}

export default App
