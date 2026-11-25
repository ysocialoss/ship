import { Button, Card, Dialog, DialogBody, FormGroup, H1, H2, Icon, InputGroup, Tag, TextArea } from '@blueprintjs/core'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { projectPath } from './routing'
import { ShareDialog } from './ShareDialog'
import { canEdit } from './workspace'
import type { IntakeItem, Invite, Module, Project, ProjectData, Task } from './workspace'

interface ProjectsDialogProps {
  isOpen: boolean
  onClose: () => void
  currentUsername: string
  projects: Project[]
  invites: Invite[]
  onOpenInvite: (invite: Invite) => void
  activeProjectId?: string
  /** Loaded data of the active project, for its work item count. */
  activeData: ProjectData | null
  onCreate: (name: string) => void
  onUpdate: (projectId: string, patch: Partial<Project>) => void
  onShareChange: (project: Project) => void
  onDelete: (projectId: string) => void
  onLeave: (projectId: string) => void
}

export function ProjectsDialog({
  isOpen, onClose, currentUsername, projects, invites, onOpenInvite, activeProjectId, activeData,
  onCreate, onUpdate, onShareChange, onDelete, onLeave,
}: ProjectsDialogProps) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [sharingId, setSharingId] = useState<string | null>(null)
  const sharing = projects.find((project) => project.id === sharingId)
  const showForm = creating || projects.length === 0

  function close() {
    setCreating(false)
    setName('')
    setEditingId(null)
    setDeletingId(null)
    setSharingId(null)
    onClose()
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    onCreate(trimmed)
    close()
  }

  function commitRename(project: Project) {
    const trimmed = editName.trim()
    if (trimmed && trimmed !== project.name) onUpdate(project.id, { name: trimmed })
    setEditingId(null)
  }

  return (
    <>
      <Dialog isOpen={isOpen && !sharing} onClose={close} title="Projects" usePortal={false}>
        <DialogBody>
          {invites.length > 0 && (
            <>
              <h3 className="share-heading">Invitations</h3>
              <ul className="project-list">
                {invites.map((invite) => (
                  <li key={invite.projectId} className="project-row">
                    <button type="button" className="project-row-main project-invite" onClick={() => onOpenInvite(invite)}>
                      <span className="project-card-title">
                        <Icon icon="envelope" size={14} aria-hidden="true" /> {invite.projectName}
                      </span>
                      <span className="bp6-text-muted">From @{invite.owner} - click to accept or decline</span>
                    </button>
                    <Tag minimal intent="primary">New</Tag>
                  </li>
                ))}
              </ul>
              <h3 className="share-heading">Your projects</h3>
            </>
          )}
          {projects.length === 0 && <p>You don't have any projects yet. Name your first one to get started.</p>}
          <ul className="project-list">
            {projects.map((project) => {
              const active = project.id === activeProjectId
              const count = active ? (activeData?.tasks.length ?? null) : null
              const people = project.people.filter((person) => person.status === 'accepted').length
              const owned = project.myRole === 'owner'
              const itemCount = count === null ? '' : `${count} ${count === 1 ? 'work item' : 'work items'}`
              return (
                <li key={project.id} className="project-row">
                  {editingId === project.id ? (
                    <InputGroup
                      autoFocus
                      aria-label="Project name"
                      value={editName}
                      onChange={(event) => setEditName(event.currentTarget.value)}
                      onBlur={() => commitRename(project)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') commitRename(project)
                        if (event.key === 'Escape') { event.stopPropagation(); setEditingId(null) }
                      }}
                    />
                  ) : (
                    <>
                      <a className="project-row-main" href={projectPath(project.id, 'work-items')} onClick={close}>
                        <span className="project-card-title">{project.name}</span>
                        <span className="bp6-text-muted">
                          {[
                            owned ? 'Yours' : `Shared by @${project.owner}`,
                            itemCount,
                            owned && people > 0 ? `shared with ${people} ${people === 1 ? 'person' : 'people'}` : '',
                            active ? 'current' : '',
                          ].filter(Boolean).join(' - ')}
                        </span>
                      </a>
                      {deletingId === project.id ? (
                        <div className="project-row-actions" role="group" aria-label={(owned ? 'Confirm deleting ' : 'Confirm leaving ') + project.name}>
                          <Button
                            intent="danger"
                            size="small"
                            onClick={() => { (owned ? onDelete : onLeave)(project.id); setDeletingId(null) }}
                          >
                            {owned ? (count === null ? 'Delete project' : `Delete with ${count} ${count === 1 ? 'item' : 'items'}`) : 'Leave project'}
                          </Button>
                          <Button variant="minimal" size="small" onClick={() => setDeletingId(null)}>Cancel</Button>
                        </div>
                      ) : (
                        <div className="project-row-actions">
                          <Button variant="minimal" icon="share" aria-label={'Share ' + project.name} onClick={() => setSharingId(project.id)} />
                          {canEdit(project) && (
                            <Button variant="minimal" icon="edit" aria-label={'Rename ' + project.name} onClick={() => { setEditingId(project.id); setEditName(project.name) }} />
                          )}
                          {owned ? (
                            <Button variant="minimal" icon="trash" aria-label={'Delete ' + project.name} onClick={() => setDeletingId(project.id)} />
                          ) : (
                            <Button variant="minimal" icon="log-out" aria-label={'Leave ' + project.name} onClick={() => setDeletingId(project.id)} />
                          )}
                        </div>
                      )}
                    </>
                  )}
                </li>
              )
            })}
          </ul>
          {showForm ? (
            <form className="project-form" onSubmit={submit}>
              <InputGroup autoFocus aria-label="Project name" placeholder="Project name" value={name} onChange={(event) => setName(event.currentTarget.value)} />
              <div className="composer-actions">
                <Button type="submit" intent="primary" disabled={!name.trim()}>Create project</Button>
                {projects.length > 0 && <Button variant="minimal" onClick={() => { setCreating(false); setName('') }}>Cancel</Button>}
              </div>
            </form>
          ) : (
            <Button icon="plus" onClick={() => setCreating(true)}>New project</Button>
          )}
        </DialogBody>
      </Dialog>
      {sharing && (
        <ShareDialog
          project={sharing}
          currentUsername={currentUsername}
          onClose={() => setSharingId(null)}
          onChange={onShareChange}
          onUpdate={(patch) => onUpdate(sharing.id, patch)}
        />
      )}
    </>
  )
}

interface ProjectViewProps {
  data: ProjectData
  onChange: (data: ProjectData) => void
}

export function ModulesView({ data, onChange }: ProjectViewProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    const module: Module = { id: crypto.randomUUID(), name: trimmed, description: description.trim() }
    onChange({ ...data, modules: [...data.modules, module] })
    setName('')
    setDescription('')
  }

  function removeModule(moduleId: string) {
    // Work items keep existing; they just lose their module.
    const tasks: Task[] = data.tasks.map((task) => (task.moduleId === moduleId ? { ...task, moduleId: '' } : task))
    onChange({ ...data, tasks, modules: data.modules.filter((module) => module.id !== moduleId) })
  }

  return (
    <main className="workspace-view">
      <H1 id="modules">Modules</H1>
      <form className="project-form" onSubmit={submit}>
        <FormGroup label="Name" labelFor="module-name">
          <InputGroup id="module-name" placeholder="Module name" value={name} onChange={(event) => setName(event.currentTarget.value)} />
        </FormGroup>
        <FormGroup label="Description" labelFor="module-description">
          <TextArea id="module-description" fill rows={2} value={description} onChange={(event) => setDescription(event.currentTarget.value)} />
        </FormGroup>
        <Button type="submit" intent="primary" disabled={!name.trim()}>Add module</Button>
      </form>
      {data.modules.length === 0 && <p>No modules yet.</p>}
      <ul className="project-list">
        {data.modules.map((module) => {
          const count = data.tasks.filter((task) => task.moduleId === module.id).length
          return (
            <li key={module.id}>
              <Card className="project-card">
                <div className="project-card-header">
                  <H2>{module.name}</H2>
                  <Button variant="minimal" icon="trash" aria-label={'Remove module ' + module.name} onClick={() => removeModule(module.id)} />
                </div>
                {module.description && <p>{module.description}</p>}
                <Tag minimal>{count} {count === 1 ? 'work item' : 'work items'}</Tag>
              </Card>
            </li>
          )
        })}
      </ul>
    </main>
  )
}

export function IntakeView({ data, onChange }: ProjectViewProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = title.trim()
    if (!trimmed) return
    const item: IntakeItem = {
      id: crypto.randomUUID(),
      title: trimmed,
      description: description.trim(),
      createdAt: new Date().toISOString(),
    }
    onChange({ ...data, intake: [item, ...data.intake] })
    setTitle('')
    setDescription('')
  }

  function accept(item: IntakeItem) {
    const task: Task = {
      id: crypto.randomUUID(),
      column: 'backlog',
      title: item.title,
      description: item.description,
      labels: '',
      assigneeId: '',
      dueDate: '',
      moduleId: '',
      checklist: [],
    }
    onChange({ ...data, tasks: [...data.tasks, task], intake: data.intake.filter((entry) => entry.id !== item.id) })
  }

  function decline(itemId: string) {
    onChange({ ...data, intake: data.intake.filter((entry) => entry.id !== itemId) })
  }

  return (
    <main className="workspace-view">
      <H1 id="intake">Intake</H1>
      <form className="project-form" onSubmit={submit}>
        <FormGroup label="Title" labelFor="intake-title">
          <InputGroup id="intake-title" placeholder="What needs doing?" value={title} onChange={(event) => setTitle(event.currentTarget.value)} />
        </FormGroup>
        <FormGroup label="Details" labelFor="intake-description">
          <TextArea id="intake-description" fill rows={2} value={description} onChange={(event) => setDescription(event.currentTarget.value)} />
        </FormGroup>
        <Button type="submit" intent="primary" disabled={!title.trim()}>Add to intake</Button>
      </form>
      {data.intake.length === 0 && <p>No intake items yet.</p>}
      <ul className="project-list">
        {data.intake.map((item) => (
          <li key={item.id}>
            <Card className="project-card">
              <H2>{item.title}</H2>
              {item.description && <p>{item.description}</p>}
              <div className="composer-actions">
                <Button intent="primary" onClick={() => accept(item)}>Accept to backlog</Button>
                <Button variant="minimal" onClick={() => decline(item.id)}>Decline</Button>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </main>
  )
}
