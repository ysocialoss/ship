import { Button, MenuItem } from '@blueprintjs/core'
import { Select } from '@blueprintjs/select'

export interface DropdownOption<T extends string> {
  value: T
  label: string
}

interface DropdownProps<T extends string> {
  value: T
  options: DropdownOption<T>[]
  onChange: (value: T) => void
  id?: string
  'aria-label'?: string
  fill?: boolean
  minimal?: boolean
}

/** Blueprint Select (non-native dropdown) with a simple button target. */
export function Dropdown<T extends string>({ value, options, onChange, id, fill, minimal, ...rest }: DropdownProps<T>) {
  const current = options.find((option) => option.value === value)

  return (
    <Select<DropdownOption<T>>
      items={options}
      filterable={false}
      className={fill ? undefined : 'dropdown'}
      fill={fill}
      popoverProps={{ matchTargetWidth: fill, placement: 'bottom-start' }}
      itemRenderer={(option, { handleClick, handleFocus, modifiers }) => (
        <MenuItem
          key={option.value}
          active={modifiers.active}
          text={option.label}
          roleStructure="listoption"
          selected={option.value === value}
          onClick={handleClick}
          onFocus={handleFocus}
        />
      )}
      onItemSelect={(option) => onChange(option.value)}
    >
      <Button
        id={id}
        aria-label={rest['aria-label']}
        variant={minimal ? 'minimal' : 'outlined'}
        fill={fill}
        alignText="start"
        endIcon="caret-down"
        text={current?.label ?? ''}
      />
    </Select>
  )
}
