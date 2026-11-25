import {
  Alignment, Button, Callout, Classes, Dialog, DialogBody, Icon,
  Navbar, NavbarGroup, NavbarHeading, Spinner,
} from '@blueprintjs/core'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Board } from './Board'
import { ApiError, projectsApi } from './api'
import type { User } from './api'
import { InviteDialog } from './InviteDialog'
import { MenuSelect } from './MenuSelect'
import { IntakeView, ModulesView, ProjectsDialog } from './ProjectViews'
import { parseRoute, projectPath, projectViews } from './routing'
import type { Route } from './routing'
import { TwoFactorSettings } from './TwoFactorSettings'
import { applyOps, assignablePeople, canEdit, diffProjectData, importLocalWorkspace } from './workspace'
import type { Invite, Project, ProjectData } from './workspace'
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

function subscribeToLocation(onChange: () => void) {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

function getHash() {
  return window.location.hash
}

function App({ user, onLogout, onUserChange }: { user: User; onLogout: () => void; onUserChange: (user: User) => void }) {
  const systemDarkMode = useSyncExternalStore(darkPreference.subscribe, darkPreference.getSnapshot)
  const isDesktop = useSyncExternalStore(desktopLayout.subscribe, desktopLayout.getSnapshot)
  const [sidebarOverride, setSidebarOverride] = useState<boolean | null>(null)
  const [appearance, setAppearance] = useState<(typeof appearanceOptions)[number]['id']>('system')
  const [profileOpen, setProfileOpen] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [invites, setInvites] = useState<Invite[]>([])
  const [openInvite, setOpenInvite] = useState<Invite | null>(null)
  /** Data of the project being viewed, as last loaded from or saved to the server. */
  const [loaded, setLoaded] = useState<{ projectId: string; data: ProjectData } | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  const darkMode = appearance === 'system' ? systemDarkMode : appearance === 'dark'
  const sidebarOpen = sidebarOverride ?? isDesktop
  const hash = useSyncExternalStore(subscribeToLocation, getHash)

  const refreshList = useCallback(async () => {
    const result = await projectsApi.list()
    setProjects(result.projects)
    setInvites(result.invites)
    return result
  }, [])

  // Initial load (importing anything this browser stored before projects lived on the server),
  // then poll so invitations from other people show up without a reload.
  useEffect(() => {
    void importLocalWorkspace()
      .catch(() => false)
      .then(() => refreshList())
      .catch(() => setSyncError('Could not load your projects.'))
    const refresh = () => void refreshList().catch(() => {})
    const timer = window.setInterval(refresh, 30_000)
    window.addEventListener('focus', refresh)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
    }
  }, [refreshList])

  // Unknown or missing routes fall back to the first project's work items, or the projects list.
  const workspaceProjects = projects ?? []
  const firstProject = workspaceProjects[0]
  const fallback: Route = firstProject
    ? { kind: 'project', projectId: firstProject.id, view: 'work-items' }
    : { kind: 'projects' }
  const route = parseRoute(hash) ?? fallback
  const activeProject = route.kind === 'project' ? workspaceProjects.find((p) => p.id === route.projectId) : undefined
  const projectRoute = route.kind === 'project' && activeProject ? route : null
  const activeProjectId = activeProject?.id
  const activeData = loaded && loaded.projectId === activeProjectId ? loaded.data : null

  // What the server is known to hold, the newest local state, and the chain of saves (kept in order).
  const synced = useRef<{ projectId: string; data: ProjectData } | null>(null)
  const latest = useRef<{ projectId: string; data: ProjectData } | null>(null)
  const saving = useRef<Promise<void>>(Promise.resolve())
  const saveTimer = useRef<number | undefined>(undefined)

  const loadProject = useCallback((projectId: string) => {
    projectsApi.get(projectId).then(
      (result) => {
        synced.current = { projectId, data: result.data }
        latest.current = synced.current
        setLoaded(synced.current)
        setProjects((list) => list?.map((p) => (p.id === projectId ? result.project : p)) ?? list)
      },
      (err: unknown) => {
        // Removed from the project, or it was deleted: drop it from the list.
        if (err instanceof ApiError && err.status === 404) void refreshList().catch(() => {})
        else setSyncError('Could not load this project.')
      },
    )
  }, [refreshList])

  useEffect(() => {
    if (activeProjectId) loadProject(activeProjectId)
  }, [activeProjectId, loadProject])

  const flush = useCallback(() => {
    window.clearTimeout(saveTimer.current)
    const target = latest.current
    saving.current = saving.current.then(async () => {
      const base = synced.current
      if (!base || !target || base.projectId !== target.projectId) return
      const ops = diffProjectData(base.data, target.data)
      if (!ops.length) return
      try {
        await applyOps(target.projectId, ops)
        synced.current = target
        setSyncError(null)
      } catch (err) {
        setSyncError(err instanceof ApiError ? `Changes could not be saved: ${err.message}` : 'Changes could not be saved.')
        loadProject(target.projectId)
      }
    })
  }, [loadProject])

  function updateProjectData(data: ProjectData) {
    if (!activeProject || !canEdit(activeProject)) return
    latest.current = { projectId: activeProject.id, data }
    setLoaded(latest.current)
    // Typing produces a change per keystroke; save after a short pause instead.
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(flush, 400)
  }

  // Save pending edits before switching projects or when the page is hidden.
  useEffect(() => () => flush(), [activeProjectId, flush])
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') flush() }
    document.addEventListener('visibilitychange', onHide)
    return () => document.removeEventListener('visibilitychange', onHide)
  }, [flush])

  function replaceProject(project: Project) {
    setProjects((list) => list?.map((p) => (p.id === project.id ? project : p)) ?? list)
  }

  async function answerInvite(invite: Invite, accept: boolean) {
    if (accept) {
      const { project } = await projectsApi.acceptInvite(invite.projectId)
      setProjects((list) => [...(list ?? []).filter((p) => p.id !== project.id), project])
      window.location.hash = projectPath(project.id, 'work-items')
    } else {
      await projectsApi.declineInvite(invite.projectId)
    }
    setInvites((list) => list.filter((entry) => entry.projectId !== invite.projectId))
    setOpenInvite(null)
  }

  async function guard(action: Promise<unknown>) {
    try {
      await action
      setSyncError(null)
    } catch (err) {
      setSyncError(err instanceof ApiError ? err.message : 'Something went wrong.')
      void refreshList().catch(() => {})
    }
  }

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
            }}
          />
          <NavbarHeading>Ship</NavbarHeading>
        </NavbarGroup>
      </Navbar>
      <div className="workspace-layout">
        <aside className="app-sidebar" id="app-sidebar" hidden={!sidebarOpen}>
          <nav aria-label="Workspace navigation">
            <MenuSelect
              fill
              label="Projects"
              placement={isDesktop ? 'right-start' : 'bottom-start'}
              entries={[
                ...workspaceProjects.map((project) => ({
                  id: project.id,
                  text: project.name,
                  selected: activeProject?.id === project.id,
                  onSelect: () => {
                    window.location.hash = projectPath(project.id, 'work-items')
                    dismissMobileSidebar()
                  },
                })),
                ...invites.map((invite, index) => ({
                  id: 'invite-' + invite.projectId,
                  text: `${invite.projectName} (invitation from @${invite.owner})`,
                  icon: 'envelope' as const,
                  dividerBefore: index === 0 && workspaceProjects.length > 0,
                  dividerTitle: index === 0 ? 'Invitations' : undefined,
                  onSelect: () => {
                    setOpenInvite(invite)
                    dismissMobileSidebar()
                  },
                })),
                {
                  id: 'manage',
                  text: 'Manage projects…',
                  icon: 'cog' as const,
                  dividerBefore: workspaceProjects.length + invites.length > 0,
                  onSelect: () => {
                    setManageOpen(true)
                    dismissMobileSidebar()
                  },
                },
              ]}
            >
              <button
                type="button"
                className="sidebar-project"
                aria-label={`Project: ${activeProject?.name ?? 'none selected'}`}
              >
                <span className="sidebar-avatar">
                  <Icon icon="folder-close" size={16} aria-hidden="true" />
                </span>
                <span className="sidebar-profile-details">
                  <span className="sidebar-profile-name">{activeProject?.name ?? 'No project'}</span>
                  <span className={Classes.TEXT_MUTED}>
                    {invites.length > 0 ? `Project - ${invites.length} ${invites.length === 1 ? 'invitation' : 'invitations'}` : 'Project'}
                  </span>
                </span>
                <Icon className="sidebar-profile-chevron" icon="chevron-down" size={12} aria-hidden="true" />
              </button>
            </MenuSelect>
            {activeProject && (
              <>
                <ul className={Classes.MENU}>
                  {projectViews.map((view) => {
                    const current = projectRoute?.view === view.id
                    return (
                      <li key={view.id}>
                        <a
                          className={current ? Classes.MENU_ITEM + ' ' + Classes.ACTIVE : Classes.MENU_ITEM}
                          href={projectPath(activeProject.id, view.id)}
                          aria-current={current ? 'page' : undefined}
                          onClick={dismissMobileSidebar}
                        >
                          <Icon icon={view.icon} aria-hidden="true" />
                          <span>{view.title}</span>
                        </a>
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
          </nav>
          <div className="sidebar-footer">
            <MenuSelect
              fill
              label="Account options"
              placement={isDesktop ? 'top-start' : 'bottom-start'}
              entries={[
                { id: 'profile', text: 'Profile', icon: 'user', onSelect: () => setProfileOpen(true) },
                ...appearanceOptions.map((option, index) => ({
                  id: 'appearance-' + option.id,
                  text: option.label,
                  selected: appearance === option.id,
                  dividerTitle: index === 0 ? 'Appearance' : undefined,
                  onSelect: () => setAppearance(option.id),
                })),
                { id: 'logout', text: 'Log out', icon: 'log-out' as const, dividerBefore: true, onSelect: onLogout },
              ]}
            >
              <button
                type="button"
                className="sidebar-profile"
                aria-label={`Account options for ${user.username}`}
              >
                <span className="sidebar-avatar">
                  <Icon icon="person" size={16} aria-hidden="true" />
                </span>
                <span className="sidebar-profile-details">
                  <span className="sidebar-profile-name">{user.username}</span>
                  <span className={Classes.TEXT_MUTED}>@{user.username}</span>
                </span>
                <Icon className="sidebar-profile-chevron" icon="chevron-down" size={12} aria-hidden="true" />
              </button>
            </MenuSelect>
          </div>
        </aside>
        <div className="workspace-content">
          {syncError && (
            <Callout intent="danger" role="alert" className="workspace-alert">{syncError}</Callout>
          )}
          {activeProject && !canEdit(activeProject) && (
            <Callout intent="primary" icon="eye-open" className="workspace-alert">
              Shared by @{activeProject.owner}. You have {activeProject.myRole} access, so you can't make changes.
            </Callout>
          )}
          {projects === null || (projectRoute && !activeData) ? (
            <Spinner className="page-spinner" />
          ) : projectRoute && activeData ? (
            projectRoute.view === 'work-items' ? (
              <Board
                columns={activeData.columns}
                tasks={activeData.tasks}
                modules={activeData.modules}
                people={activeProject ? assignablePeople(activeProject) : []}
                editable={activeProject ? canEdit(activeProject) : false}
                onChange={(changes) => updateProjectData({ ...activeData, ...changes })}
              />
            ) : projectRoute.view === 'modules' ? (
              <ModulesView data={activeData} onChange={updateProjectData} />
            ) : (
              <IntakeView data={activeData} onChange={updateProjectData} />
            )
          ) : (
            <main className="workspace-view">
              <p>No project selected. Use the project menu to create one.</p>
              {invites.length > 0 && (
                <Button icon="envelope" onClick={() => setManageOpen(true)}>
                  You have {invites.length} {invites.length === 1 ? 'invitation' : 'invitations'}
                </Button>
              )}
            </main>
          )}
        </div>
      </div>
      <ProjectsDialog
        isOpen={manageOpen}
        onClose={() => setManageOpen(false)}
        projects={workspaceProjects}
        invites={invites}
        onOpenInvite={setOpenInvite}
        currentUsername={user.username}
        activeProjectId={activeProject?.id}
        activeData={activeData}
        onUpdate={(projectId, patch) => {
          setProjects((list) => list?.map((p) => (p.id === projectId ? { ...p, ...patch } : p)) ?? list)
          void guard(projectsApi.update(projectId, patch).then((r) => replaceProject(r.project)))
        }}
        onShareChange={replaceProject}
        onCreate={(name) => guard(projectsApi.create({ name }).then(({ project }) => {
          setProjects((list) => [...(list ?? []), project])
          window.location.hash = projectPath(project.id, 'work-items')
        }))}
        onDelete={(projectId) => {
          setProjects((list) => list?.filter((p) => p.id !== projectId) ?? list)
          void guard(projectsApi.remove(projectId))
        }}
        onLeave={(projectId) => {
          setProjects((list) => list?.filter((p) => p.id !== projectId) ?? list)
          void guard(projectsApi.removeMember(projectId, user.id))
        }}
      />
      {openInvite && (
        <InviteDialog invite={openInvite} onClose={() => setOpenInvite(null)} onAnswer={(accept) => answerInvite(openInvite, accept)} />
      )}
      <Dialog isOpen={profileOpen} onClose={() => setProfileOpen(false)} title="Profile" usePortal={false}>
        <DialogBody>
          <div className="profile-summary">
            <strong>{user.username}</strong>
            <span className={Classes.TEXT_MUTED}>@{user.username}</span>
          </div>
          <TwoFactorSettings user={user} onUserChange={onUserChange} />
        </DialogBody>
      </Dialog>
    </div>
  )
}

export default App
