import { Dialog, DialogBody, Spinner } from '@blueprintjs/core'
import { useEffect, useState } from 'react'
import { authApi, type User } from './api'
import App from './App'
import { AuthPage } from './AuthPage'
import { TwoFactorSettings } from './TwoFactorSettings'

export function Root() {
  const [user, setUser] = useState<User | null | undefined>(undefined)
  // Set when the user signs in during this page load (not when restoring a session).
  const [promptTotp, setPromptTotp] = useState(false)

  useEffect(() => {
    authApi.me().then((r) => setUser(r.user), () => setUser(null))
  }, [])

  if (user === undefined) return <Spinner className="page-spinner" />
  if (user === null) {
    return (
      <AuthPage
        onAuthenticated={(u) => {
          setPromptTotp(!u.totpEnabled)
          setUser(u)
        }}
      />
    )
  }
  return (
    <>
      <App
        user={user}
        onUserChange={setUser}
        onLogout={() => {
          void authApi.logout().finally(() => {
            setPromptTotp(false)
            setUser(null)
          })
        }}
      />
      <Dialog
        isOpen={promptTotp && !user.totpEnabled}
        onClose={() => setPromptTotp(false)}
        title="Secure your account"
        icon="shield"
        canOutsideClickClose={false}
      >
        <DialogBody>
          <p className="tfa-text">
            Add a second step to sign-in with an authenticator app. It only takes a minute and protects your
            account if your password is ever leaked.
          </p>
          <TwoFactorSettings user={user} onUserChange={setUser} startSetup onClose={() => setPromptTotp(false)} />
        </DialogBody>
      </Dialog>
    </>
  )
}
