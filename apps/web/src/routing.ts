export const projectViews = [
  { id: 'work-items', title: 'Work Items', icon: 'layout' },
  { id: 'modules', title: 'Modules', icon: 'layers' },
  { id: 'intake', title: 'Intake', icon: 'inbox' },
] as const

export type ProjectView = (typeof projectViews)[number]['id']

export type Route =
  | { kind: 'projects' }
  | { kind: 'project'; projectId: string; view: ProjectView }

/** `#/projects` or `#/project/<projectId>/<work-items|modules|intake>`. */
export function projectPath(projectId: string, view: ProjectView): string {
  return `#/project/${encodeURIComponent(projectId)}/${view}`
}

export function parseRoute(hash: string): Route | null {
  const parts = hash.replace(/^#\/?/, '').split('/')
  if (parts[0] === 'projects' && parts.length === 1) return { kind: 'projects' }
  if (parts[0] === 'project' && parts.length === 3 && parts[1]) {
    const view = projectViews.find((entry) => entry.id === parts[2])
    if (view) return { kind: 'project', projectId: decodeURIComponent(parts[1]), view: view.id }
  }
  return null
}
