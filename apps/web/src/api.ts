import type { Invite, Project, ProjectData, ShareRole } from './workspace'
export type User = { id: string; username: string; totpEnabled: boolean; createdAt: string }

export class ApiError extends Error {
  status: number
  fieldErrors: Record<string, string[] | undefined>
  constructor(status: number, message: string, fieldErrors: Record<string, string[] | undefined> = {}) {
    super(message)
    this.status = status
    this.fieldErrors = fieldErrors
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  return call<T>(method, '/api/auth' + path, body)
}

export async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = res.status === 204 ? null : await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, data?.error ?? 'Request failed', data?.issues)
  return data as T
}

export const authApi = {
  me: () => request<{ user: User }>('GET', '/me'),
  register: (username: string, password: string) =>
    request<{ user: User }>('POST', '/register', { username, password }),
  login: (username: string, password: string) =>
    request<{ mfaRequired: true } | { mfaRequired: false; user: User }>('POST', '/login', { username, password }),
  loginTotp: (code: string) => request<{ user: User }>('POST', '/login/totp', { code }),
  logout: () => request<null>('POST', '/logout'),
  totpSetup: (password: string) => request<{ secret: string; uri: string }>('POST', '/totp/setup', { password }),
  totpEnable: (code: string) => request<{ recoveryCodes: string[] }>('POST', '/totp/enable', { code }),
  totpDisable: (password: string, code: string) => request<null>('POST', '/totp/disable', { password, code }),
  regenerateRecoveryCodes: (password: string, code: string) =>
    request<{ recoveryCodes: string[] }>('POST', '/totp/recovery-codes', { password, code }),
}

const p = (projectId: string) => '/api/projects/' + encodeURIComponent(projectId)

export const projectsApi = {
  list: () => call<{ projects: Project[]; invites: Invite[] }>('GET', '/api/projects'),
  get: (projectId: string) => call<{ project: Project; data: ProjectData }>('GET', p(projectId)),
  create: (body: { id?: string; name: string; description?: string }) =>
    call<{ project: Project }>('POST', '/api/projects', body),
  update: (projectId: string, patch: Partial<Pick<Project, 'name' | 'description' | 'linkAccess' | 'linkRole'>>) =>
    call<{ project: Project }>('PATCH', p(projectId), patch),
  remove: (projectId: string) => call<null>('DELETE', p(projectId)),
  acceptInvite: (projectId: string) => call<{ project: Project }>('POST', p(projectId) + '/invite/accept'),
  declineInvite: (projectId: string) => call<null>('POST', p(projectId) + '/invite/decline'),
  invite: (projectId: string, usernames: string[], role: ShareRole) =>
    call<{ project: Project }>('POST', p(projectId) + '/members', { usernames, role }),
  setMemberRole: (projectId: string, userId: string, role: ShareRole) =>
    call<{ project: Project }>('PATCH', p(projectId) + '/members/' + userId, { role }),
  removeMember: (projectId: string, userId: string) => call<null>('DELETE', p(projectId) + '/members/' + userId),
  /** kind is 'tasks' | 'modules' | 'intake'. */
  createItem: (projectId: string, kind: string, body: object) => call<unknown>('POST', p(projectId) + '/' + kind, body),
  updateItem: (projectId: string, kind: string, id: string, body: object) =>
    call<unknown>('PATCH', p(projectId) + '/' + kind + '/' + id, body),
  removeItem: (projectId: string, kind: string, id: string) =>
    call<null>('DELETE', p(projectId) + '/' + kind + '/' + id),
}

export const usersApi = {
  search: (q: string) =>
    call<{ users: { id: string; username: string }[] }>('GET', '/api/users/search?q=' + encodeURIComponent(q)),
}
