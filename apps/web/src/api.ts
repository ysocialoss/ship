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
  const res = await fetch('/api/auth' + path, {
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
