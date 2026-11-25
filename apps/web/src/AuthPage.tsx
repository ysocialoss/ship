import { Button, Callout, Card, FormGroup, H3, InputGroup, Intent, Tab, Tabs } from '@blueprintjs/core'
import { type FormEvent, useState } from 'react'
import { ApiError, authApi, type User } from './api'

type Props = { onAuthenticated: (user: User) => void }
type Mode = 'login' | 'register'

export function AuthPage({ onAuthenticated }: Props) {
  const [mode, setMode] = useState<Mode>('login')
  const [step, setStep] = useState<'credentials' | 'totp'>('credentials')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<ApiError | null>(null)
  const [loading, setLoading] = useState(false)

  async function run(action: () => Promise<void>) {
    setLoading(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'Could not reach the server'))
    } finally {
      setLoading(false)
    }
  }

  function submitCredentials(event: FormEvent) {
    event.preventDefault()
    void run(async () => {
      if (mode === 'register') {
        onAuthenticated((await authApi.register(username, password)).user)
        return
      }
      const result = await authApi.login(username, password)
      if (result.mfaRequired) {
        setPassword('')
        setStep('totp')
      } else {
        onAuthenticated(result.user)
      }
    })
  }

  function submitCode(value: string) {
    if (loading) return
    void run(async () => {
      try {
        onAuthenticated((await authApi.loginTotp(value)).user)
      } catch (err) {
        setCode('')
        // The pending sign-in is gone (expired or too many bad codes): start over.
        if (err instanceof ApiError && /again/i.test(err.message)) setStep('credentials')
        throw err
      }
    })
  }

  const fieldError = (name: string) => error?.fieldErrors[name]?.[0]
  const errorCallout = error && (
    <Callout intent={Intent.DANGER} icon="error">
      {error.message}
    </Callout>
  )

  if (step === 'totp') {
    return (
      <div className="auth-page">
      <Card className="auth-card">
        <H3>Two-factor authentication</H3>
        <form className="auth-form" onSubmit={(event: FormEvent) => { event.preventDefault(); submitCode(code) }}>
          <FormGroup label="Code" labelFor="totp-code" helperText="Enter the 6-digit code from your app, or a recovery code.">
            <InputGroup
              id="totp-code"
              autoFocus
              autoComplete="one-time-code"
              inputMode="numeric"
              value={code}
              onValueChange={(value) => {
                setCode(value)
                // Recovery codes contain a dash, so only a pure 6-digit entry auto-submits.
                if (/^\d{6}$/.test(value)) submitCode(value)
              }}
            />
          </FormGroup>
          {errorCallout}
          <div className="tfa-actions">
            <Button type="submit" intent={Intent.PRIMARY} text="Verify" loading={loading} disabled={!code} />
            <Button variant="minimal" text="Back" onClick={() => { setStep('credentials'); setError(null) }} />
          </div>
        </form>
      </Card>
      </div>
    )
  }

  return (
    <div className="auth-page">
    <Card className="auth-card">
      <Tabs
        id="auth-mode"
        selectedTabId={mode}
        onChange={(id) => { setMode(id as Mode); setError(null) }}
      >
        <Tab id="login" title="Log in" />
        <Tab id="register" title="Register" />
      </Tabs>
      <form className="auth-form" onSubmit={submitCredentials}>
        <FormGroup
          label="Username"
          labelFor="username"
          intent={fieldError('username') ? Intent.DANGER : Intent.NONE}
          helperText={fieldError('username')}
        >
          <InputGroup
            id="username"
            autoFocus
            autoComplete="username"
            value={username}
            onValueChange={setUsername}
            intent={fieldError('username') ? Intent.DANGER : Intent.NONE}
          />
        </FormGroup>
        <FormGroup
          label="Password"
          labelFor="password"
          intent={fieldError('password') ? Intent.DANGER : Intent.NONE}
          helperText={fieldError('password') ?? (mode === 'register' ? 'At least 12 characters.' : undefined)}
        >
          <InputGroup
            id="password"
            type="password"
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            value={password}
            onValueChange={setPassword}
            intent={fieldError('password') ? Intent.DANGER : Intent.NONE}
          />
        </FormGroup>
        {errorCallout}
        <Button
          type="submit"
          intent={Intent.PRIMARY}
          text={mode === 'login' ? 'Log in' : 'Create account'}
          loading={loading}
          disabled={!username || !password}
          fill
        />
      </form>
    </Card>
    </div>
  )
}
