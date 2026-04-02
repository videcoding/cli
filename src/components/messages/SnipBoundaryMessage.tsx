import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { useShortcutDisplay } from '../../keybindings/useShortcutDisplay.js'

type Props = {
  message: {
    snipMetadata?: {
      removedCount?: number
      tokensFreed?: number
    }
  }
}

export function SnipBoundaryMessage({ message }: Props): React.ReactNode {
  const historyShortcut = useShortcutDisplay(
    'app:toggleTranscript',
    'Global',
    'ctrl+o',
  )
  const removedCount = message.snipMetadata?.removedCount ?? 0
  const tokensFreed = message.snipMetadata?.tokensFreed ?? 0

  return (
    <Box marginY={1}>
      <Text dimColor>
        ✻ Earlier context trimmed
        {removedCount > 0 ? ` (${removedCount} msgs` : ''}
        {removedCount > 0 && tokensFreed > 0 ? `, ~${tokensFreed} tokens` : ''}
        {removedCount > 0 ? ')' : ''}
        {` (${historyShortcut} for history)`}
      </Text>
    </Box>
  )
}
