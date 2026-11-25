import {
  Button, Card, Checkbox, Dialog, DialogBody, FormGroup, H1, H2,
  InputGroup, Tag, TextArea,
} from '@blueprintjs/core'
import { Dropdown } from './Dropdown'
import {
  DndContext, DragOverlay, MouseSensor, TouchSensor, pointerWithin,
  useDraggable, useDroppable, useSensor, useSensors,
} from '@dnd-kit/core'
import type { CollisionDetection, DragEndEvent, DragMoveEvent } from '@dnd-kit/core'
import { lazy, Suspense, useLayoutEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { columns } from './boardColumns'
import type { ColumnId } from './boardColumns'
import type { Assignable, Module, Task } from './workspace'

const DateInput = lazy(async () => {
  const { DateInput } = await import('@blueprintjs/datetime')
  return { default: DateInput }
})

interface DropTarget {
  column: ColumnId
  cardId?: string
  after: boolean
}

const detectCollision: CollisionDetection = (args) => {
  const hits = pointerWithin(args)
  const card = hits.find(({ id }) => !columns.some((column) => column.id === id))
  return card ? [card] : hits
}

export function Board({ tasks, modules, people, onTasksChange }: {
  tasks: Task[]
  modules: Module[]
  /** Who work items can be assigned to. */
  people: Assignable[]
  onTasksChange: (tasks: Task[]) => void
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const selected = tasks.find((task) => task.id === selectedId)
  const dragged = tasks.find((task) => task.id === draggedId)
  const draggedColumn = columns.find((column) => column.id === dragged?.column)
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
  )

  function saveTasks(next: Task[]) {
    onTasksChange(next)
  }

  function addTask(column: ColumnId, title: string) {
    const task: Task = {
      id: crypto.randomUUID(), column, title,
      description: '', labels: '', assigneeId: '', dueDate: '', moduleId: '', checklist: [],
    }
    saveTasks([...tasks, task])
    setAnnouncement(title + ' added to ' + columns.find((entry) => entry.id === column)?.title)
  }

  function updateTask(id: string, changes: Partial<Omit<Task, 'id' | 'column'>>) {
    saveTasks(tasks.map((task) => task.id === id ? { ...task, ...changes } : task))
  }

  function moveTask(id: string, column: ColumnId, targetId?: string, placeAfter = false) {
    if (id === targetId) return

    const task = tasks.find((item) => item.id === id)
    if (!task) return

    const next = tasks.filter((item) => item.id !== id)
    const index = next.findIndex((item) => item.id === targetId && item.column === column)
    const offset = placeAfter ? 1 : 0
    next.splice(index < 0 ? next.length : index + offset, 0, { ...task, column })
    saveTasks(next)
    setAnnouncement(task.title + ' moved to ' + columns.find((entry) => entry.id === column)?.title)
  }

  function getDropTarget({ active, over }: DragMoveEvent): DropTarget | null {
    if (!over || over.id === active.id) return null

    const lane = columns.find((column) => column.id === over.id)
    if (lane) return { column: lane.id, after: false }

    const card = tasks.find((task) => task.id === over.id)
    const translated = active.rect.current.translated
    if (!card || !translated) return null

    const after = translated.top + translated.height / 2 > over.rect.top + over.rect.height / 2
    return { column: card.column, cardId: card.id, after }
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
          {columns.map((column) => {
            const cards = tasks.filter((task) => task.column === column.id)

            return (
              <DropLane key={column.id} id={column.id} highlighted={dropTarget?.column === column.id}>
                <LaneContent column={column} count={cards.length} onAdd={(title) => addTask(column.id, title)}>
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
            modules={modules}
            people={people}
            onChange={(changes) => updateTask(selected.id, changes)}
            onMove={(column) => moveTask(selected.id, column)}
          />
        )}
      </Dialog>
    </main>
  )
}

function DropLane({ id, highlighted, children }: {
  id: ColumnId
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
  column: (typeof columns)[number]
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
        <Tag icon={column.icon} intent={column.intent} minimal>{column.title}</Tag>
        {labels.map((label) => <Tag key={label} intent="primary" minimal>{label}</Tag>)}
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

function LaneContent({ column, count, onAdd, children }: {
  column: (typeof columns)[number]
  count: number
  onAdd: (title: string) => void
  children: ReactNode
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [title, setTitle] = useState('')
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
        <div className="lane-title">
          <H2 id={column.id + '-heading'}>{column.title}</H2>
          <Tag minimal aria-label={count + (count === 1 ? ' card' : ' cards')}>{count}</Tag>
        </div>
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
function TaskDetails({ task, modules, people, onChange, onMove }: {
  task: Task
  modules: Module[]
  people: Assignable[]
  onChange: (changes: Partial<Omit<Task, 'id' | 'column'>>) => void
  onMove: (column: ColumnId) => void
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
          value={task.column}
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
