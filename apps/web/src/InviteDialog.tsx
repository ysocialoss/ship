import { Button, Callout, Classes, Dialog, DialogBody, DialogFooter } from '@blueprintjs/core'
import { useState } from 'react'
import { ApiError } from './api'
import type { Invite } from './workspace'

const roleText = {
  viewer: 'view',
  commenter: 'view and comment on',
  editor: 'view and edit',
} as const

interface InviteDialogProps {
  invite: Invite
  onClose: () => void
  onAnswer: (accept: boolean) => Promise<void>
}

/** A pending project invitation: join the project or turn it down. */
export function InviteDialog({ invite, onClose, onAnswer }: InviteDialogProps) {
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function answer(accept: boolean) {
    setBusy(accept ? 'accept' : 'decline')
    setError(null)
    try {
      await onAnswer(accept)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.')
      setBusy(null)
    }
  }

  return (
    <Dialog isOpen onClose={onClose} title="Project invitation" icon="envelope" usePortal={false}>
      <DialogBody>
        <p>
          <strong>@{invite.owner}</strong> invited you to {roleText[invite.role]} <strong>{invite.projectName}</strong>.
        </p>
        <p className={Classes.TEXT_MUTED}>
          Accept to add it to your projects. If you decline, @{invite.owner} would have to invite you again.
        </p>
        {error && <Callout intent="danger" role="alert">{error}</Callout>}
      </DialogBody>
      <DialogFooter
        actions={
          <>
            <Button onClick={() => void answer(false)} loading={busy === 'decline'} disabled={busy !== null}>Decline</Button>
            <Button intent="primary" onClick={() => void answer(true)} loading={busy === 'accept'} disabled={busy !== null}>
              Accept invitation
            </Button>
          </>
        }
      />
    </Dialog>
  )
}
