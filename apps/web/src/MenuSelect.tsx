import { Menu, MenuDivider, MenuItem } from '@blueprintjs/core'
import type { IconName, Placement } from '@blueprintjs/core'
import { Select } from '@blueprintjs/select'
import { Fragment, useState } from 'react'
import type { ReactNode } from 'react'

export interface MenuEntry {
  id: string
  text: string
  icon?: IconName
  /** Shows a tick, for radio-style entries. */
  selected?: boolean
  /** Renders a divider (with an optional title) above this entry. */
  dividerBefore?: boolean
  dividerTitle?: string
  onSelect: () => void
}

interface MenuSelectProps {
  entries: MenuEntry[]
  label: string
  placement?: Placement
  fill?: boolean
  /** Called once the menu has finished closing and focus is back on its trigger. */
  onClosed?: () => void
  children: ReactNode
}

/** Blueprint Select used as a menu: entries are either choices (with a tick) or actions. */
export function MenuSelect({ entries, label, placement = 'bottom-start', fill, onClosed, children }: MenuSelectProps) {
  // Select pre-highlights the first item on open; only show the highlight once the user uses the keyboard.
  const [keyboardNav, setKeyboardNav] = useState(false)
  return (
    <Select<MenuEntry>
      items={entries}
      filterable={false}
      fill={fill}
      popoverProps={{ placement, onClosed: () => { setKeyboardNav(false); onClosed?.() } }}
      popoverContentProps={{ onKeyDown: () => setKeyboardNav(true) }}
      onItemSelect={(entry) => entry.onSelect()}
      itemRenderer={(entry, { handleClick, handleFocus, modifiers }) => (
        <MenuItem
          key={entry.id}
          active={keyboardNav && modifiers.active}
          icon={entry.icon}
          text={entry.text}
          selected={entry.selected}
          roleStructure={entry.selected === undefined ? 'menuitem' : 'listoption'}
          onClick={handleClick}
          onFocus={handleFocus}
        />
      )}
      itemListRenderer={({ filteredItems, itemsParentRef, renderItem }) => (
        <Menu ulRef={itemsParentRef} aria-label={label}>
          {filteredItems.map((entry, index) => (
            <Fragment key={entry.id}>
              {(entry.dividerBefore || entry.dividerTitle) && <MenuDivider title={entry.dividerTitle} />}
              {renderItem(entry, index)}
            </Fragment>
          ))}
        </Menu>
      )}
    >
      {children}
    </Select>
  )
}
