import type { Message } from '../../types/message.js'

type SnipBoundaryLike = {
  type?: string
  snipMetadata?: {
    removedUuids?: string[]
  }
}

export function isSnipBoundaryMessage(message: unknown): boolean {
  if (!message || typeof message !== 'object') {
    return false
  }
  const candidate = message as SnipBoundaryLike
  return (
    candidate.type === 'system' &&
    Array.isArray(candidate.snipMetadata?.removedUuids)
  )
}

export function projectSnippedView<T extends Message>(messages: T[]): T[] {
  const removed = new Set<string>()
  for (const message of messages) {
    if (!isSnipBoundaryMessage(message)) {
      continue
    }
    for (const uuid of message.snipMetadata?.removedUuids ?? []) {
      removed.add(uuid)
    }
  }

  if (removed.size === 0) {
    return messages.filter(message => !isSnipBoundaryMessage(message))
  }

  return messages.filter(message => {
    if (isSnipBoundaryMessage(message)) {
      return false
    }
    return !removed.has((message as { uuid?: string }).uuid ?? '')
  })
}
