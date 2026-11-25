import type { IconName, Intent } from '@blueprintjs/core'

/** A column ("holder") on the Work Items board. Each project has its own, in order. */
export interface BoardColumn {
  id: string
  title: string
  intent: Intent
}

export const columnColors: { intent: Intent; label: string }[] = [
  { intent: 'none', label: 'Gray' },
  { intent: 'primary', label: 'Blue' },
  { intent: 'success', label: 'Green' },
  { intent: 'warning', label: 'Orange' },
  { intent: 'danger', label: 'Red' },
]

export const columnIcon: Record<Intent, IconName> = {
  none: 'circle',
  primary: 'time',
  success: 'tick-circle',
  warning: 'eye-open',
  danger: 'error',
}
