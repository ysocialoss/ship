import {
  Button, Card, Checkbox, Dialog, DialogBody, DialogFooter, FormGroup, H1, H2, Icon,
  InputGroup, Tag, TextArea,
} from '@blueprintjs/core'
import { Dropdown } from './Dropdown'
import { MenuSelect } from './MenuSelect'
import type { MenuEntry } from './MenuSelect'
import {
  DndContext, DragOverlay, MouseSensor, TouchSensor, pointerWithin,
  useDraggable, useDroppable, useSensor, useSensors,
} from '@dnd-kit/core'
import type { CollisionDetection, DragEndEvent, DragMoveEvent } from '@dnd-kit/core'
import { lazy, Suspense, useLayoutEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { columnColors, columnIcon } from './boardColumns'
import type { BoardColumn } from './boardColumns'
import type { Assignable, Module, Task } from './workspace'

const DateInput = lazy(async () => {
  const { DateInput } = await import('@blueprintjs/datetime')
  return { default: DateInput }
})

interface DropTarget {
  column: string
  cardId?: string
  after: boolean
}

export function Board({ columns, tasks, modules, people, editable, onChange }: {
  columns: BoardColumn[]
  tasks: Task[]
  modules: Module[]
  /** Who work items can be assigned to. */
  people: Assignable[]
  /** Whether the current user may change the board's columns. */
  editable: boolean
  onChange: (changes: { columns?: BoardColumn[]; tasks?: Task[] }) => void
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const selected = tasks.find((task) => task.id === selectedId)
  const dragged = tasks.find((task) => task.id === draggedId)
  const draggedColumn = columns.find((column) => column.id === dragged?.columnId)
  const deleting = columns.find((column) => column.id === deletingId)

  const detectCollision: CollisionDetection = (args) => {
    const hits = pointerWithin(args)
    const card = hits.find(({ id }) => !columns.some((column) => column.id === id))
    return card ? [card] : hits
  }
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
  )

  function saveTasks(next: Task[]) {
    onChange({ tasks: next })
  }

  const columnTitle = (id: string) => columns.find((entry) => entry.id === id)?.title

  function addColumn(title: string) {
    onChange({ columns: [...columns, { id: crypto.randomUUID(), title, intent: 'none' }] })
    setAnnouncement('Column ' + title + ' added')
  }

  function updateColumn(id: string, changes: Partial<Omit<BoardColumn, 'id'>>) {
    onChange({ columns: columns.map((column) => column.id === id ? { ...column, ...changes } : column) })
  }

  function shiftColumn(id: string, by: -1 | 1) {
    const from = columns.findIndex((column) => column.id === id)
    const to = from + by
    if (from < 0 || to < 0 || to >= columns.length) return
    const next = [...columns]
    const [column] = next.splice(from, 1)
    next.splice(to, 0, column!)
    onChange({ columns: next })
    setAnnouncement(column!.title + ' moved ' + (by < 0 ? 'left' : 'right'))
  }

  /** Removes a column; its work items go to moveTo, keeping their order. */
  function removeColumn(id: string, moveTo?: string) {
    const removed = columns.find((column) => column.id === id)
    if (!removed || columns.length < 2) return
    const held = tasks.filter((task) => task.columnId === id)
    if (held.length && !moveTo) return
    const nextTasks = held.length
      ? [...tasks.filter((task) => task.columnId !== id), ...held.map((task) => ({ ...task, columnId: moveTo! }))]
      : tasks
    onChange({ columns: columns.filter((column) => column.id !== id), tasks: nextTasks })
    setAnnouncement('Column ' + removed.title + ' deleted'
      + (held.length ? ', ' + held.length + (held.length === 1 ? ' card' : ' cards') + ' moved to ' + columnTitle(moveTo!) : ''))
  }

  function addTask(columnId: string, title: string) {
    const task: Task = {
      id: crypto.randomUUID(), columnId, title,
      description: '', labels: '', assigneeId: '', dueDate: '', moduleId: '', checklist: [],
    }
    saveTasks([...tasks, task])
    setAnnouncement(title + ' added to ' + columnTitle(columnId))
  }

  function updateTask(id: string, changes: Partial<Omit<Task, 'id' | 'columnId'>>) {
    saveTasks(tasks.map((task) => task.id === id ? { ...task, ...changes } : task))
  }

  function moveTask(id: string, column: string, targetId?: string, placeAfter = false) {
    if (id === targetId) return

    const task = tasks.find((item) => item.id === id)
    if (!task) return

    const next = tasks.filter((item) => item.id !== id)
    const index = next.findIndex((item) => item.id === targetId && item.columnId === column)
    const offset = placeAfter ? 1 : 0
    next.splice(index < 0 ? next.length : index + offset, 0, { ...task, columnId: column })
    saveTasks(next)
    setAnnouncement(task.title + ' moved to ' + columnTitle(column))
  }

  function getDropTarget({ active, over }: DragMoveEvent): DropTarget | null {
    if (!over || over.id === active.id) return null

    const lane = columns.find((column) => column.id === over.id)
    if (lane) return { column: lane.id, after: false }

    const card = tasks.find((task) => task.id === over.id)
    const translated = active.rect.current.translated
    if (!card || !translated) return null

    const after = translated.top + translated.height / 2 > over.rect.top + over.rect.height / 2
    return { column: card.columnId, cardId: card.id, after }
  }

  function previewDrop(event: DragMoveEvent) {
    const next = getDropTarget(event)
    setDropTarget((previous) => (
      previous?.column === next?.column && previous?.cardId === next?.cardId && previous?.after === next?.after
        ? previous
        : next
    ))
  }

  function clearDrag() {
    setDraggedId(null)
    setDropTarget(null)
  }

  function finishDrag(event: DragEndEvent) {
    const target = getDropTarget(event)
    if (target && typeof event.active.id === 'string') {
      moveTask(event.active.id, target.column, target.cardId, target.after)
    }
    clearDrag()
  }
  return (
    <main className="board">
      <H1 id="work-items">Work Items</H1>
      <div className="board-announcement" role="status">{announcement}</div>
      <DndContext
        sensors={sensors}
        collisionDetection={detectCollision}
        onDragStart={({ active }) => setDraggedId(String(active.id))}
        onDragMove={previewDrop}
        onDragOver={previewDrop}
        onDragCancel={clearDrag}
        onDragEnd={finishDrag}
      >
        <div className="board-lanes" role="region" aria-label="Kanban columns">
          {columns.map((column, index) => {
            const cards = tasks.filter((task) => task.columnId === column.id)

            return (
              <DropLane key={column.id} id={column.id} highlighted={dropTarget?.column === column.id}>
                <LaneContent
                  column={column}
                  count={cards.length}
                  onAdd={(title) => addTask(column.id, title)}
                  manage={editable ? {
                    isFirst: index === 0,
                    isLast: index === columns.length - 1,
                    isOnly: columns.length === 1,
                    onRename: (title) => updateColumn(column.id, { title }),
                    onColor: (intent) => updateColumn(column.id, { intent }),
                    onShift: (by) => shiftColumn(column.id, by),
                    onDelete: () => (cards.length ? setDeletingId(column.id) : removeColumn(column.id)),
                  } : undefined}
                >
                  <ul className="board-cards">
                    {cards.map((task) => {
                      const marker = dropTarget?.cardId === task.id && draggedId !== task.id
                        ? dropTarget.after ? 'after' : 'before'
                        : undefined
                      return (
                        <DragCard key={task.id} id={task.id} marker={marker}>
                          <CardContent task={task} column={column} people={people} onOpen={() => setSelectedId(task.id)} />
                        </DragCard>
                      )
                    })}
                  </ul>
                </LaneContent>
              </DropLane>
            )
          })}
          {editable && <AddColumn onAdd={addColumn} />}
        </div>
        <DragOverlay>
          {dragged && draggedColumn && (
            <div className="board-drag-preview" aria-hidden="true">
              <Card className="board-card">
                <CardContent task={dragged} column={draggedColumn} people={people} />
              </Card>
            </div>
          )}
        </DragOverlay>
      </DndContext>
      <Dialog isOpen={selected !== undefined} onClose={() => setSelectedId(null)} title="Card details" usePortal={false}>
        {selected && (
          <TaskDetails
            key={selected.id}
            task={selected}
            columns={columns}
            modules={modules}
            people={people}
            onChange={(changes) => updateTask(selected.id, changes)}
            onMove={(column) => moveTask(selected.id, column)}
          />
        )}
      </Dialog>
      {deleting && (
        <DeleteColumnDialog
          key={deleting.id}
          column={deleting}
          others={columns.filter((column) => column.id !== deleting.id)}
          count={tasks.filter((task) => task.columnId === deleting.id).length}
          onCancel={() => setDeletingId(null)}
          onConfirm={(moveTo) => {
            removeColumn(deleting.id, moveTo)
            setDeletingId(null)
          }}
        />
      )}
    </main>
  )
}

function DeleteColumnDialog({ column, others, count, onCancel, onConfirm }: {
  column: BoardColumn
  others: BoardColumn[]
  count: number
  onCancel: () => void
  onConfirm: (moveTo: string) => void
}) {
  const [moveTo, setMoveTo] = useState(others[0]?.id ?? '')
  return (
    <Dialog isOpen usePortal={false} icon="trash" title={'Delete ' + column.title + '?'} onClose={onCancel}>
      <DialogBody>
        <p>
          <strong>{column.title}</strong> holds {count} {count === 1 ? 'card' : 'cards'}.
          Choose where {count === 1 ? 'it goes' : 'they go'} before the column is deleted.
        </p>
        <FormGroup label="Move cards to" labelFor="delete-column-target">
          <Dropdown
            id="delete-column-target"
            fill
            value={moveTo}
            options={others.map(({ id, title }) => ({ value: id, label: title }))}
            onChange={setMoveTo}
          />
        </FormGroup>
      </DialogBody>
      <DialogFooter actions={<>
        <Button onClick={onCancel}>Cancel</Button>
        <Button intent="danger" disabled={!moveTo} onClick={() => onConfirm(moveTo)}>Delete column</Button>
      </>} />
    </Dialog>
  )
}

function AddColumn({ onAdd }: { onAdd: (title: string) => void }) {
  const [isOpen, setIsOpen] = useState(false)
  const [title, setTitle] = useState('')

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!title.trim()) return
    onAdd(title.trim())
    setTitle('')
  }

  function close() {
    setIsOpen(false)
    setTitle('')
  }

  if (!isOpen) {
    return (
      <button type="button" className="board-lane board-add-column board-add-column-trigger" onClick={() => setIsOpen(true)}>
        <Icon icon="plus" />
        Add column
      </button>
    )
  }

  return (
    <section className="board-lane board-add-column" aria-label="Add column">
      <form className="card-composer" onSubmit={submit} onKeyDown={(event) => { if (event.key === 'Escape') close() }}>
        <InputGroup
          autoFocus
          aria-label="New column name"
          placeholder="Column name"
          maxLength={100}
          value={title}
          onChange={(event) => setTitle(event.currentTarget.value)}
        />
        <div className="composer-actions">
          <Button type="submit" intent="primary" disabled={!title.trim()}>Add column</Button>
          <Button variant="minimal" onClick={close}>Cancel</Button>
        </div>
      </form>
    </section>
  )
}

function DropLane({ id, highlighted, children }: {
  id: string
  highlighted: boolean
  children: ReactNode
}) {
  const { setNodeRef } = useDroppable({ id })
  return (
    <section
      ref={setNodeRef}
      className={highlighted ? 'board-lane is-drop-lane' : 'board-lane'}
      aria-labelledby={id + '-heading'}
    >
      {children}
    </section>
  )
}

function DragCard({ id, marker, children }: {
  id: string
  marker?: 'after' | 'before'
  children: ReactNode
}) {
  const { isDragging, listeners, setNodeRef } = useDraggable({ id })
  const { setNodeRef: setDropRef } = useDroppable({ id })

  return (
    <li ref={setDropRef} className="board-slot" data-drop={marker}>
      <div ref={setNodeRef} {...listeners}>
        <Card className={isDragging ? 'board-card is-dragging' : 'board-card'}>
          {children}
        </Card>
      </div>
    </li>
  )
}

function CardContent({ task, column, people, onOpen }: {
  people: Assignable[]
  task: Task
  column: BoardColumn
  onOpen?: () => void
}) {
  const title = task.title.trim() || 'Untitled card'
  const completed = task.checklist.filter((item) => item.done).length
  const assignee = task.assigneeId ? people.find(({ id }) => id === task.assigneeId) : undefined
  const labels = [...new Set(task.labels.split(',').map((label) => label.trim()).filter(Boolean))]

  return (
    <>
      {onOpen ? (
        <button type="button" className="board-card-title" onClick={onOpen}>{title}</button>
      ) : (
        <span className="board-card-title">{title}</span>
      )}
      <div className="card-meta">
        <Tag icon={columnIcon[column.intent]} intent={column.intent} minimal>{column.title}</Tag>
        {labels.map((label) => <Tag key={label} minimal>{label}</Tag>)}
        {assignee && <Tag minimal icon="person">@{assignee.username}</Tag>}
        {task.dueDate && <Tag minimal>Due {task.dueDate}</Tag>}
        {task.checklist.length > 0 && (
          <Tag minimal icon="tick" intent={completed === task.checklist.length ? 'success' : 'none'}>
            <span aria-label={completed + ' of ' + task.checklist.length + ' checklist items complete'}>
              {completed}/{task.checklist.length}
            </span>
          </Tag>
        )}
      </div>
    </>
  )
}

interface LaneManagement {
  isFirst: boolean
  isLast: boolean
  isOnly: boolean
  onRename: (title: string) => void
  onColor: (intent: BoardColumn['intent']) => void
  onShift: (by: -1 | 1) => void
  onDelete: () => void
}

function LaneContent({ column, count, onAdd, manage, children }: {
  column: BoardColumn
  count: number
  onAdd: (title: string) => void
  /** Column actions; absent for people who can't edit the board. */
  manage?: LaneManagement
  children: ReactNode
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(column.title)
  const menuButton = useRef<HTMLButtonElement>(null)
  // The menu hands focus back to its button as it closes, which would blur the rename field at once.
  const renameRequested = useRef(false)

  function startRename() {
    setName(column.title)
    setRenaming(true)
  }

  function finishRename(save: boolean) {
    if (!renaming) return
    const trimmed = name.trim()
    if (save && trimmed && trimmed !== column.title) manage?.onRename(trimmed)
    setRenaming(false)
    menuButton.current?.focus()
  }

  const menu: MenuEntry[] = manage ? [
    { id: 'rename', text: 'Rename', icon: 'edit', onSelect: () => { renameRequested.current = true } },
    ...(manage.isFirst ? [] : [{ id: 'left', text: 'Move left', icon: 'arrow-left' as const, onSelect: () => manage.onShift(-1) }]),
    ...(manage.isLast ? [] : [{ id: 'right', text: 'Move right', icon: 'arrow-right' as const, onSelect: () => manage.onShift(1) }]),
    ...columnColors.map(({ intent, label }, index) => ({
      id: 'color-' + intent,
      text: label,
      selected: column.intent === intent,
      dividerTitle: index === 0 ? 'Color' : undefined,
      onSelect: () => manage.onColor(intent),
    })),
    ...(manage.isOnly ? [] : [{ id: 'delete', text: 'Delete column', icon: 'trash' as const, dividerBefore: true, onSelect: manage.onDelete }]),
  ] : []
  const trigger = useRef<HTMLElement | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const composerId = column.id + '-composer'

  useLayoutEffect(() => {
    if (!isOpen && trigger.current) {
      trigger.current.focus()
      trigger.current = null
    }
  }, [isOpen])

  function open(button: HTMLElement) {
    trigger.current = button
    if (isOpen) {
      input.current?.focus()
      return
    }
    setIsOpen(true)
  }

  function close() {
    setIsOpen(false)
    setTitle('')
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!title.trim()) return
    onAdd(title.trim())
    setTitle('')
    input.current?.focus()
  }

  return (
    <>
      <header className="lane-header">
        {renaming ? (
          <form
            className="lane-rename"
            onSubmit={(event) => { event.preventDefault(); finishRename(true) }}
            onKeyDown={(event) => { if (event.key === 'Escape') finishRename(false) }}
          >
            <InputGroup
              autoFocus
              size="small"
              aria-label={'Rename column ' + column.title}
              maxLength={100}
              value={name}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => setName(event.currentTarget.value)}
              onBlur={() => finishRename(true)}
            />
          </form>
        ) : (
          <div className="lane-title">
            <H2 id={column.id + '-heading'} onDoubleClick={manage ? startRename : undefined}>{column.title}</H2>
            <Tag minimal aria-label={count + (count === 1 ? ' card' : ' cards')}>{count}</Tag>
          </div>
        )}
        <div className="lane-actions">
          {manage && (
            <MenuSelect
              entries={menu}
              label={column.title + ' column options'}
              placement="bottom-end"
              onClosed={() => {
                if (!renameRequested.current) return
                renameRequested.current = false
                startRename()
              }}
            >
              <Button
                ref={menuButton}
                className="lane-menu"
                variant="minimal"
                size="small"
                icon="more"
                aria-label={column.title + ' column options'}
              />
            </MenuSelect>
          )}
          <Button
          className="lane-quick-add"
          variant="minimal"
          size="small"
          icon="plus"
          aria-label={'Quick add card in ' + column.title}
          aria-expanded={isOpen}
          aria-controls={isOpen ? composerId : undefined}
          onClick={(event) => open(event.currentTarget)}
          />
        </div>
      </header>
      {children}
      <Button
        className="add-card-trigger"
        hidden={isOpen}
        variant="minimal"
        fill
        alignText="start"
        icon="plus"
        aria-label={'Add card in ' + column.title}
        aria-expanded={isOpen}
        aria-controls={isOpen ? composerId : undefined}
        onClick={(event) => open(event.currentTarget)}
      >
        Add card
      </Button>
      {isOpen && (
        <form
          id={composerId}
          className="card-composer"
          onSubmit={submit}
          onKeyDown={(event) => {
            if (event.key === 'Escape') close()
          }}
        >
          <InputGroup
            autoFocus
            inputRef={input}
            aria-label={'New card title in ' + column.title}
            placeholder="Card title"
            value={title}
            onChange={(event) => setTitle(event.currentTarget.value)}
          />
          <div className="composer-actions">
            <Button type="submit" intent="primary" disabled={!title.trim()} aria-keyshortcuts="Enter">Add card <kbd className="composer-shortcut" aria-hidden="true">Enter</kbd></Button>
            <Button variant="minimal" onClick={close} aria-keyshortcuts="Escape">Cancel <kbd className="composer-shortcut" aria-hidden="true">Esc</kbd></Button>
          </div>
      </form>
      )}
    </>
  )
}
function TaskDetails({ task, columns, modules, people, onChange, onMove }: {
  task: Task
  columns: BoardColumn[]
  modules: Module[]
  people: Assignable[]
  onChange: (changes: Partial<Omit<Task, 'id' | 'columnId'>>) => void
  onMove: (column: string) => void
}) {
  const [itemTitle, setItemTitle] = useState('')

  function addItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!itemTitle.trim()) return
    onChange({ checklist: [...task.checklist, { id: crypto.randomUUID(), title: itemTitle.trim(), done: false }] })
    setItemTitle('')
  }

  return (
    <DialogBody>
      <FormGroup label="Title" labelFor="task-title">
        <InputGroup id="task-title" value={task.title} onChange={(event) => onChange({ title: event.currentTarget.value })} />
      </FormGroup>
      <FormGroup label="Move to" labelFor="task-column">
        <Dropdown
          id="task-column"
          value={task.columnId}
          options={columns.map(({ id, title }) => ({ value: id, label: title }))}
          onChange={(value) => {
            const column = columns.find(({ id }) => id === value)
            if (column) onMove(column.id)
          }}
        />
      </FormGroup>
      <FormGroup label="Module" labelFor="task-module">
        <Dropdown
          id="task-module"
          fill
          value={task.moduleId}
          options={[{ value: '', label: 'No module' }, ...modules.map(({ id, name }) => ({ value: id, label: name }))]}
          onChange={(moduleId) => onChange({ moduleId })}
        />
      </FormGroup>
      <FormGroup label="Description" labelFor="task-description">
        <TextArea fill rows={3} id="task-description" value={task.description} onChange={(event) => onChange({ description: event.currentTarget.value })} />
      </FormGroup>
      <FormGroup label="Labels" labelFor="task-labels">
        <InputGroup id="task-labels" placeholder="Separate labels with commas" value={task.labels} onChange={(event) => onChange({ labels: event.currentTarget.value })} />
      </FormGroup>
      <div className="task-metadata-fields">
        <FormGroup label="Assignee" labelFor="task-assignee">
          <Dropdown
            id="task-assignee"
            fill
            value={task.assigneeId}
            options={[
              { value: '', label: 'Unassigned' },
              ...people.map(({ id, username }) => ({ value: id, label: '@' + username })),
              // Keep showing someone who has since left, rather than silently blanking the field.
              ...(task.assigneeId && !people.some(({ id }) => id === task.assigneeId)
                ? [{ value: task.assigneeId, label: 'Former member' }]
                : []),
            ]}
            onChange={(assigneeId) => onChange({ assigneeId })}
          />
        </FormGroup>
        <FormGroup label="Due date" labelFor="task-due-date">
          <Suspense fallback={<InputGroup id="task-due-date" disabled />}>
            <DateInput
              fill
              dateFnsFormat="yyyy-MM-dd"
              timezone="UTC"
              value={task.dueDate ? task.dueDate + 'T00:00:00Z' : null}
              inputProps={{ id: 'task-due-date', leftIcon: 'calendar' }}
              popoverProps={{ usePortal: false }}
              showActionsBar
              onChange={(date, userChange) => {
                if (userChange) onChange({ dueDate: date?.slice(0, 10) ?? '' })
              }}
            />
          </Suspense>
        </FormGroup>
      </div>
      <H2 className="checklist-heading">Checklist</H2>
      <ul className="task-checklist">
        {task.checklist.map((item) => (
          <li key={item.id}>
            <Checkbox
              label={item.title}
              checked={item.done}
              onChange={(event) => {
                const done = event.currentTarget.checked
                onChange({ checklist: task.checklist.map((entry) => entry.id === item.id ? { ...entry, done } : entry) })
              }}
            />
            <Button variant="minimal" aria-label={'Remove ' + item.title} onClick={() => onChange({ checklist: task.checklist.filter((entry) => entry.id !== item.id) })}>
              Remove
            </Button>
          </li>
        ))}
      </ul>
      <form className="add-card" onSubmit={addItem}>
        <InputGroup aria-label="New checklist item" placeholder="Checklist item" value={itemTitle} onChange={(event) => setItemTitle(event.currentTarget.value)} />
        <Button type="submit" disabled={!itemTitle.trim()}>Add item</Button>
      </form>
    </DialogBody>
  )
}
