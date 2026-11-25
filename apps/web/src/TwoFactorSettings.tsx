import { Button, Callout, Code, FormGroup, H4, InputGroup, Intent, Pre, Tag } from '@blueprintjs/core'
import { QRCodeSVG } from 'qrcode.react'
import { type FormEvent, useState } from 'react'
import { ApiError, authApi, type User } from './api'

type Props = {
  user: User
  onUserChange: (user: User) => void
  /** Start the enable flow immediately (used by the first-login dialog). */
  startSetup?: boolean
  /** Called when the flow returns to idle (finished or cancelled). */
  onClose?: () => void
}

type Step =
  | { kind: 'idle' }
  | { kind: 'password' } // confirm password before generating a secret
  | { kind: 'scan'; secret: string; uri: string }
  | { kind: 'codes'; recoveryCodes: string[] }
  | { kind: 'disable' }
  | { kind: 'regenerate' }

export function TwoFactorSettings({ user, onUserChange, startSetup, onClose }: Props) {
  const [step, setStep] = useState<Step>(startSetup ? { kind: 'password' } : { kind: 'idle' })
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [scanned, setScanned] = useState(false)
  const [showKey, setShowKey] = useState(false)

  function go(next: Step) {
    setStep(next)
    setPassword('')
    setCode('')
    setError(null)
    setScanned(false)
    setShowKey(false)
    if (next.kind === 'idle') onClose?.()
  }

  function submit(action: () => Promise<void>) {
    return (event: FormEvent) => {
      event.preventDefault()
      setLoading(true)
      setError(null)
      action()
        .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Could not reach the server'))
        .finally(() => setLoading(false))
    }
  }

  function enable(value: string) {
    if (loading) return
    setLoading(true)
    setError(null)
    authApi
      .totpEnable(value)
      .then(({ recoveryCodes }) => {
        onUserChange({ ...user, totpEnabled: true })
        go({ kind: 'codes', recoveryCodes })
      })
      .catch((err: unknown) => {
        setCode('')
        setError(err instanceof ApiError ? err.message : 'Could not reach the server')
      })
      .finally(() => setLoading(false))
  }

  const errorCallout = error && (
    <Callout className="tfa-gap" intent={Intent.DANGER} icon="error">
      {error}
    </Callout>
  )
  const cancel = (
    <Button variant="minimal" text={startSetup ? 'Not now' : 'Cancel'} onClick={() => go({ kind: 'idle' })} />
  )

  const passwordField = (
    <FormGroup label="Password" labelFor="tfa-password">
      <InputGroup
        id="tfa-password"
        type="password"
        autoComplete="current-password"
        autoFocus
        value={password}
        onValueChange={setPassword}
      />
    </FormGroup>
  )
  function confirmWithCode(value: string) {
    if (loading || !password || (step.kind !== 'disable' && step.kind !== 'regenerate')) return
    const kind = step.kind
    setLoading(true)
    setError(null)
    const action = async () => {
      if (kind === 'disable') {
        await authApi.totpDisable(password, value)
        onUserChange({ ...user, totpEnabled: false })
        go({ kind: 'idle' })
      } else {
        const { recoveryCodes } = await authApi.regenerateRecoveryCodes(password, value)
        go({ kind: 'codes', recoveryCodes })
      }
    }
    action()
      .catch((err: unknown) => {
        setCode('')
        setError(err instanceof ApiError ? err.message : 'Could not reach the server')
      })
      .finally(() => setLoading(false))
  }

  const codeField = (helperText: string, autoFocus = false) => (
    <FormGroup label="Code" labelFor="tfa-code" helperText={helperText}>
      <InputGroup
        id="tfa-code"
        autoComplete="one-time-code"
        autoFocus={autoFocus}
        value={code}
        onValueChange={(value) => {
          setCode(value)
          // Recovery codes contain a dash, so only a pure 6-digit entry auto-submits.
          if (/^\d{6}$/.test(value)) confirmWithCode(value)
        }}
      />
    </FormGroup>
  )

  let body
  switch (step.kind) {
    case 'idle':
      body = user.totpEnabled ? (
        <div className="tfa-actions">
          <Button icon="refresh" text="New recovery codes" onClick={() => go({ kind: 'regenerate' })} />
          <Button icon="disable" intent={Intent.DANGER} text="Turn off" onClick={() => go({ kind: 'disable' })} />
        </div>
      ) : (
        <Button icon="lock" intent={Intent.PRIMARY} text="Set up" onClick={() => go({ kind: 'password' })} />
      )
      break

    case 'password':
      body = (
        <form
          className="tfa-form"
          onSubmit={submit(async () => {
            const { secret, uri } = await authApi.totpSetup(password)
            go({ kind: 'scan', secret, uri })
          })}
        >
          {passwordField}
          {errorCallout}
          <div className="tfa-actions">
            <Button type="submit" intent={Intent.PRIMARY} text="Continue" loading={loading} disabled={!password} />
            {cancel}
          </div>
        </form>
      )
      break

    case 'scan':
      body = !scanned ? (
        <div className="tfa-form">
          <p className="tfa-text">Step 1 of 2: scan this QR code with your authenticator app.</p>
          <div className="tfa-qr">
            <QRCodeSVG value={step.uri} size={176} marginSize={2} />
          </div>
          <Button
            className="tfa-key-toggle"
            variant="minimal"
            size="small"
            icon={showKey ? 'chevron-down' : 'chevron-right'}
            text="Can't scan?"
            aria-expanded={showKey}
            onClick={() => setShowKey(!showKey)}
          />
          {showKey && (
            <p className="tfa-text">
              Enter this key manually:
              <br />
              <Code className="tfa-secret">{step.secret}</Code>
            </p>
          )}
          <div className="tfa-actions">
            <Button intent={Intent.PRIMARY} text="I've scanned it" onClick={() => setScanned(true)} />
            {cancel}
          </div>
        </div>
      ) : (
        <form className="tfa-form" onSubmit={(event) => { event.preventDefault(); enable(code) }}>
          <p className="tfa-text">Step 2 of 2: enter the 6-digit code your app now shows.</p>
          <FormGroup label="Code" labelFor="tfa-code" helperText="Submits automatically once all 6 digits are entered.">
            <InputGroup
              id="tfa-code"
              autoComplete="one-time-code"
              inputMode="numeric"
              maxLength={6}
              autoFocus
              disabled={loading}
              value={code}
              onValueChange={(value) => {
                const digits = value.replace(/\D/g, '').slice(0, 6)
                setCode(digits)
                if (digits.length === 6) enable(digits)
              }}
            />
          </FormGroup>
          {errorCallout}
          <div className="tfa-actions">
            <Button type="submit" intent={Intent.PRIMARY} text="Turn on" loading={loading} disabled={!code} />
            <Button variant="minimal" text="Back" onClick={() => { setScanned(false); setCode(''); setError(null) }} />
          </div>
        </form>
      )
      break

    case 'codes':
      body = (
        <div className="tfa-form">
          <Callout intent={Intent.WARNING} icon="warning-sign" title="Save your recovery codes">
            Each code works once if you lose your authenticator. They won&apos;t be shown again.
          </Callout>
          <Pre className="tfa-codes">{step.recoveryCodes.join('\n')}</Pre>
          <div className="tfa-actions">
            <Button
              icon="duplicate"
              text="Copy"
              onClick={() => void navigator.clipboard.writeText(step.recoveryCodes.join('\n'))}
            />
            <Button intent={Intent.PRIMARY} text="Done" onClick={() => go({ kind: 'idle' })} />
          </div>
        </div>
      )
      break

    case 'disable':
    case 'regenerate':
      body = (
        <form
          className="tfa-form"
          onSubmit={submit(async () => {
            if (step.kind === 'disable') {
              await authApi.totpDisable(password, code)
              onUserChange({ ...user, totpEnabled: false })
              go({ kind: 'idle' })
            } else {
              const { recoveryCodes } = await authApi.regenerateRecoveryCodes(password, code)
              go({ kind: 'codes', recoveryCodes })
            }
          })}
        >
          {passwordField}
          {codeField('A 6-digit code from your app, or a recovery code.')}
          {errorCallout}
          <div className="tfa-actions">
            <Button
              type="submit"
              intent={step.kind === 'disable' ? Intent.DANGER : Intent.PRIMARY}
              text={step.kind === 'disable' ? 'Turn off' : 'Generate new codes'}
              loading={loading}
              disabled={!password || !code}
            />
            {cancel}
          </div>
        </form>
      )
      break
  }

  if (startSetup) return <section>{body}</section>

  return (
    <section className="tfa-section">
      <H4 className="tfa-heading">
        Two-factor authentication
        <Tag intent={user.totpEnabled ? Intent.SUCCESS : Intent.NONE} minimal>
          {user.totpEnabled ? 'On' : 'Off'}
        </Tag>
      </H4>
      {body}
    </section>
  )
}
