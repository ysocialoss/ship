import { Button, Callout, Classes, Dialog, DialogBody, DialogFooter, Icon } from '@blueprintjs/core'
import { useState } from 'react'
import { ApiError, projectsApi } from './api'
import { Dropdown } from './Dropdown'
import { PeoplePicker } from './PeoplePicker'
import type { Contact } from './PeoplePicker'
import type { Project, ShareRole } from './workspace'

const roleOptions: { value: ShareRole; label: string }[] = [
  { value: 'viewer', label: 'Viewer' },
  { value: 'commenter', label: 'Commenter' },
  { value: 'editor', label: 'Editor' },
]
const roleLabel = (role: string) => roleOptions.find((option) => option.value === role)?.label ?? 'Owner'

interface ShareDialogProps {
  project: Project
  currentUsername: string
  onClose: () => void
  /** Called with the project as the server returns it after each change. */
  onChange: (project: Project) => void
  onUpdate: (patch: Partial<Project>) => void
}

/** Invite people by username. They see the project as an invitation until they accept it. */
export function ShareDialog({ project, currentUsername, onClose, onChange, onUpdate }: ShareDialogProps) {
  const isOwner = project.myRole === 'owner'
  const [pending, setPending] = useState<Contact[]>([])
  const [query, setQuery] = useState('')
  const [role, setRole] = useState<ShareRole>('editor')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function run(action: () => Promise<{ project: Project } | null>) {
    setBusy(true)
    setError(null)
    try {
      const result = await action()
      if (result) onChange(result.project)
      return true
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function invite() {
    if (pending.length === 0) return
    const ok = await run(() => projectsApi.invite(project.id, pending.map((contact) => contact.username), role))
    if (ok) {
      setPending([])
      setQuery('')
    }
  }

  function changeRole(userId: string, value: ShareRole | 'remove') {
    if (value === 'remove') {
      void run(async () => {
        await projectsApi.removeMember(project.id, userId)
        return { project: { ...project, people: project.people.filter((person) => person.userId !== userId) } }
      })
    } else {
      void run(() => projectsApi.setMemberRole(project.id, userId, value))
    }
  }

  function copyLink() {
    void navigator.clipboard?.writeText(`${window.location.origin}/#/project/${project.id}/work-items`)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  const composing = pending.length > 0 || query.trim().length > 0

  return (
    <Dialog isOpen onClose={onClose} title={`Share "${project.name}"`} usePortal={false}>
      <DialogBody>
        {isOwner && (
          <PeoplePicker
            selected={pending}
            onChange={setPending}
            query={query}
            onQueryChange={setQuery}
            excluded={project.people.map((person) => person.userId)}
          />
        )}
        {error && <Callout intent="danger" role="alert" className="share-error">{error}</Callout>}

        {composing ? (
          <div className="share-compose">
            <div className="share-footer">
              <Dropdown aria-label="Role for new people" value={role} onChange={setRole} options={roleOptions} />
              <span className={Classes.TEXT_MUTED}>They'll see an invitation in their projects.</span>
            </div>
          </div>
        ) : (
          <>
            <h3 className="share-heading">People with access</h3>
            <ul className="share-people">
              <li className="share-person">
                <span className="sidebar-avatar"><Icon icon="person" size={16} aria-hidden="true" /></span>
                <span className="share-person-details">
                  <span className="sidebar-profile-name">
                    @{project.owner}{project.owner === currentUsername ? ' (you)' : ''}
                  </span>
                </span>
                <span className={Classes.TEXT_MUTED}>Owner</span>
              </li>
              {project.people.map((person) => (
                <li key={person.userId} className="share-person">
                  <span className="sidebar-avatar"><Icon icon="person" size={16} aria-hidden="true" /></span>
                  <span className="share-person-details">
                    <span className="sidebar-profile-name">
                      @{person.username}{person.username === currentUsername ? ' (you)' : ''}
                    </span>
                    {person.status === 'pending' && <span className={Classes.TEXT_MUTED}>Invitation pending</span>}
                  </span>
                  {isOwner ? (
                    <Dropdown
                      minimal
                      aria-label={'Access for @' + person.username}
                      value={person.role}
                      onChange={(value) => changeRole(person.userId, value)}
                      options={[
                        ...roleOptions,
                        { value: 'remove' as const, label: person.status === 'pending' ? 'Cancel invitation' : 'Remove access' },
                      ]}
                    />
                  ) : (
                    <span className={Classes.TEXT_MUTED}>{roleLabel(person.role)}</span>
                  )}
                </li>
              ))}
            </ul>

            {isOwner && (
              <>
                <h3 className="share-heading">General access</h3>
                <div className="share-person">
                  <span className="sidebar-avatar">
                    <Icon icon={project.linkAccess === 'anyone' ? 'globe' : 'lock'} size={16} aria-hidden="true" />
                  </span>
                  <span className="share-person-details">
                    <Dropdown
                      minimal
                      aria-label="General access"
                      value={project.linkAccess}
                      onChange={(value) => onUpdate({ linkAccess: value })}
                      options={[{ value: 'restricted', label: 'Restricted' }, { value: 'anyone', label: 'Anyone with the link' }]}
                    />
                    <span className={Classes.TEXT_MUTED}>
                      {project.linkAccess === 'anyone'
                        ? 'Anyone signed in with the link can open this project.'
                        : 'Only people added above can open this project.'}
                    </span>
                  </span>
                  {project.linkAccess === 'anyone' && (
                    <Dropdown
                      minimal
                      aria-label="Access for anyone with the link"
                      value={project.linkRole}
                      onChange={(value) => onUpdate({ linkRole: value })}
                      options={roleOptions}
                    />
                  )}
                </div>
              </>
            )}
          </>
        )}
      </DialogBody>
      <DialogFooter
        actions={
          composing ? (
            <>
              <Button onClick={() => { setPending([]); setQuery('') }}>Cancel</Button>
              <Button intent="primary" onClick={() => void invite()} loading={busy} disabled={pending.length === 0}>Invite</Button>
            </>
          ) : (
            <Button intent="primary" onClick={onClose}>Done</Button>
          )
        }
      >
        <Button icon={copied ? 'tick' : 'link'} onClick={copyLink}>{copied ? 'Link copied' : 'Copy link'}</Button>
      </DialogFooter>
    </Dialog>
  )
}
