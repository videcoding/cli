import React, { useState } from 'react'
import { Box, Text } from '../../ink.js'
import { Select } from '../CustomSelect/index.js'
import { Dialog } from '../design-system/Dialog.js'
import { Spinner } from '../Spinner.js'
import {
  markSnapshotSynced,
  replaceFromSnapshot,
} from '../../tools/AgentTool/agentMemorySnapshot.js'
import {
  type AgentMemoryScope,
  getAgentMemoryDir,
} from '../../tools/AgentTool/agentMemory.js'
import { getSnapshotDirForAgent } from '../../tools/AgentTool/agentMemorySnapshot.js'

type Props = {
  agentType: string
  scope: AgentMemoryScope
  snapshotTimestamp: string
  onComplete: (choice: 'merge' | 'keep' | 'replace') => void
  onCancel: () => void
}

export function buildMergePrompt(
  agentType: string,
  scope: AgentMemoryScope,
): string {
  const snapshotDir = getSnapshotDirForAgent(agentType)
  const localDir = getAgentMemoryDir(agentType, scope)
  return [
    `A newer memory snapshot is available for the ${agentType} agent.`,
    `Review and merge any useful updates from ${snapshotDir} into ${localDir}.`,
    'Preserve any newer local notes that should win over the snapshot.',
  ].join('\n')
}

export function SnapshotUpdateDialog({
  agentType,
  scope,
  snapshotTimestamp,
  onComplete,
  onCancel,
}: Props): React.ReactNode {
  const [busy, setBusy] = useState(false)

  const runChoice = (choice: 'merge' | 'keep' | 'replace') => {
    setBusy(true)
    const action =
      choice === 'replace'
        ? replaceFromSnapshot(agentType, scope, snapshotTimestamp)
        : markSnapshotSynced(agentType, scope, snapshotTimestamp)

    void action
      .then(() => {
        onComplete(choice)
      })
      .catch(() => {
        onComplete('keep')
      })
      .finally(() => {
        setBusy(false)
      })
  }

  return (
    <Dialog
      title="Agent Memory Snapshot"
      onCancel={onCancel}
      color="background"
    >
      <Text dimColor>
        A project snapshot from {snapshotTimestamp} is newer than the local{' '}
        {agentType} memory.
      </Text>

      {busy ? (
        <Box flexDirection="row">
          <Spinner />
          <Text> Updating local snapshot state…</Text>
        </Box>
      ) : (
        <Select
          options={[
            { label: 'Merge into prompt', value: 'merge' },
            { label: 'Replace local memory', value: 'replace' },
            { label: 'Keep local memory', value: 'keep' },
          ]}
          onChange={value =>
            runChoice(value as 'merge' | 'keep' | 'replace')
          }
        />
      )}
    </Dialog>
  )
}
