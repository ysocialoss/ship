import { MenuItem } from '@blueprintjs/core'
import { MultiSelect } from '@blueprintjs/select'
import { useEffect, useState } from 'react'
import { usersApi } from './api'

export interface Contact {
  id: string
  username: string
}

interface PeoplePickerProps {
  selected: Contact[]
  onChange: (contacts: Contact[]) => void
  query: string
  onQueryChange: (query: string) => void
  /** User ids that already have access or an invitation; they are not suggested again. */
  excluded: string[]
}

/** Add people by username, searched as you type. */
export function PeoplePicker({ selected, onChange, query, onQueryChange, excluded }: PeoplePickerProps) {
  const [results, setResults] = useState<Contact[]>([])
  const [searching, setSearching] = useState(false)
  const needle = query.trim().replace(/^@/, '')

  useEffect(() => {
    if (!needle) {
      setResults([])
      return
    }
    let current = true
    setSearching(true)
    const timer = window.setTimeout(() => {
      usersApi.search(needle).then(
        (r) => { if (current) setResults(r.users) },
        () => { if (current) setResults([]) },
      ).finally(() => { if (current) setSearching(false) })
    }, 200)
    return () => {
      current = false
      window.clearTimeout(timer)
    }
  }, [needle])

  const items = results.filter((contact) => !excluded.includes(contact.id))
  const isSelected = (contact: Contact) => selected.some((entry) => entry.id === contact.id)

  return (
    <MultiSelect<Contact>
      fill
      items={items}
      selectedItems={selected}
      query={query}
      onQueryChange={onQueryChange}
      itemsEqual="id"
      resetOnSelect
      openOnKeyDown
      placeholder={selected.length === 0 ? 'Add people by username' : ''}
      noResults={
        <MenuItem
          disabled
          text={!needle ? 'Start typing a username' : searching ? 'Searching…' : 'No user with that name'}
          roleStructure="listoption"
        />
      }
      onItemSelect={(contact) => { if (!isSelected(contact)) onChange([...selected, contact]) }}
      onRemove={(contact) => onChange(selected.filter((entry) => entry.id !== contact.id))}
      tagRenderer={(contact) => '@' + contact.username}
      tagInputProps={{ tagProps: { minimal: true }, inputProps: { autoFocus: true, 'aria-label': 'Add people by username' } }}
      popoverProps={{ matchTargetWidth: true, placement: 'bottom-start' }}
      itemRenderer={(contact, { handleClick, handleFocus, modifiers }) => (
        <MenuItem
          key={contact.id}
          active={modifiers.active}
          icon={isSelected(contact) ? 'tick' : 'person'}
          text={'@' + contact.username}
          roleStructure="listoption"
          onClick={handleClick}
          onFocus={handleFocus}
        />
      )}
    />
  )
}
