import React from 'react'
import { Text } from '../ink.js'
import { Select } from '../components/CustomSelect/index.js'
import { Dialog } from '../components/design-system/Dialog.js'
import type { AssistantSession } from './sessionDiscovery.js'

type Props = {
  sessions: AssistantSession[]
  onSelect: (id: string) => void
  onCancel: () => void
}

export function AssistantSessionChooser({
  sessions,
  onSelect,
  onCancel,
}: Props): React.ReactNode {
  const options = [
    ...sessions.map(session => ({
      label: session.label,
      value: session.id,
    })),
    {
      label: 'Cancel',
      value: '__cancel__',
    },
  ]

  return (
    <Dialog title="Assistant Sessions" onCancel={onCancel} color="background">
      <Text dimColor>Select a running assistant session to attach to.</Text>
      <Select
        options={options}
        onChange={value => {
          if (value === '__cancel__') {
            onCancel()
            return
          }
          onSelect(value)
        }}
      />
    </Dialog>
  )
}
