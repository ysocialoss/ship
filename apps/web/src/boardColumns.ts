export const columns = [
  { id: 'backlog', title: 'Backlog', icon: 'circle', intent: 'none' },
  { id: 'todo', title: 'To do', icon: 'circle', intent: 'none' },
  { id: 'progress', title: 'In progress', icon: 'time', intent: 'primary' },
  { id: 'review', title: 'In review', icon: 'eye-open', intent: 'warning' },
  { id: 'done', title: 'Done', icon: 'tick-circle', intent: 'success' },
] as const

export type ColumnId = (typeof columns)[number]['id']
