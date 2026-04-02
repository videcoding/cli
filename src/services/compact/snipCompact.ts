import type { UUID } from 'crypto'
import { randomUUID } from 'crypto'
import { createSystemMessage } from '../../utils/messages.js'
import { tokenCountWithEstimation } from '../../utils/tokens.js'
import { getEffectiveContextWindowSize } from './autoCompact.js'
import type { Message } from '../../types/message.js'

const NUDGE_INTERVAL_TOKENS = 10_000
const AUTO_SNIP_THRESHOLD_RATIO = 0.72
const AUTO_SNIP_TARGET_RATIO = 0.58
const MIN_REMOVAL_TOKENS = 8_000
const PROTECTED_TAIL_MESSAGES = 10

export const SNIP_NUDGE_TEXT =
  'The conversation is getting large. If earlier turns are no longer needed verbatim, use Snip to trim stale history and keep the active context focused.'

type SnipBoundaryMetadata = {
  removedUuids: UUID[]
  removedCount: number
  tokensFreed: number
  createdAt: string
}

type SnipBoundaryMessage = Message & {
  snipMetadata: SnipBoundaryMetadata
}

type SnipResult<T> = {
  messages: T[]
  tokensFreed: number
  boundaryMessage?: T
  executed: boolean
}

function isEnvEnabled(name: string): boolean {
  const value = process.env[name]
  return value === '1' || value === 'true' || value === 'yes' || value === 'on'
}

export function isSnipRuntimeEnabled(): boolean {
  return process.env.USER_TYPE === 'ant' || isEnvEnabled('CLAUDE_HISTORY_SNIP')
}

function isCompactBoundary(message: unknown): boolean {
  return (
    !!message &&
    typeof message === 'object' &&
    (message as { type?: string }).type === 'system' &&
    (message as { subtype?: string }).subtype === 'compact_boundary'
  )
}

function isSnipBoundaryMessage(message: unknown): message is SnipBoundaryMessage {
  return (
    !!message &&
    typeof message === 'object' &&
    (message as { type?: string }).type === 'system' &&
    Array.isArray(
      (message as { snipMetadata?: { removedUuids?: UUID[] } }).snipMetadata
        ?.removedUuids,
    )
  )
}

function estimateTokens(messages: Message[]): number {
  return tokenCountWithEstimation(messages)
}

function estimateMessageTokens(message: Message): number {
  return estimateTokens([message])
}

function getTextPayload(message: Message): string | null {
  if (message.type === 'system') {
    return typeof message.content === 'string' ? message.content : null
  }

  const payload = (message as { message?: { content?: unknown } }).message?.content
  if (typeof payload === 'string') {
    return payload
  }
  if (!Array.isArray(payload)) {
    return null
  }

  for (const block of payload) {
    if (!block || typeof block !== 'object') continue
    if (
      'type' in block &&
      (block as { type?: string }).type === 'text' &&
      'text' in block &&
      typeof (block as { text?: string }).text === 'string'
    ) {
      const text = (block as { text: string }).text.trim()
      if (text.length > 0) return text
    }
    if (
      'type' in block &&
      (block as { type?: string }).type === 'tool_use' &&
      'name' in block &&
      typeof (block as { name?: string }).name === 'string'
    ) {
      return `Tool call: ${(block as { name: string }).name}`
    }
  }

  return null
}

function selectSnipRange(messages: Message[]): {
  startIndex: number
  endIndex: number
  removedUuids: UUID[]
  tokensFreed: number
} | null {
  if (messages.length <= PROTECTED_TAIL_MESSAGES + 1) {
    return null
  }

  const effectiveWindow = getEffectiveContextWindowSize(
    process.env.CLAUDE_CODE_MAIN_MODEL ?? 'claude',
  )
  const totalTokens = estimateTokens(messages)
  if (totalTokens < effectiveWindow * AUTO_SNIP_THRESHOLD_RATIO) {
    return null
  }

  const targetTokens = Math.floor(effectiveWindow * AUTO_SNIP_TARGET_RATIO)
  const tokensToRemove = Math.max(
    MIN_REMOVAL_TOKENS,
    totalTokens - targetTokens,
  )

  const lastRemovableIndex = Math.max(
    0,
    messages.length - PROTECTED_TAIL_MESSAGES - 1,
  )

  let startIndex = -1
  let endIndex = -1
  let freedTokens = 0
  const removedUuids: UUID[] = []

  for (let i = 0; i <= lastRemovableIndex; i++) {
    const message = messages[i]!
    if (isCompactBoundary(message) || isSnipBoundaryMessage(message)) {
      continue
    }
    if (
      message.type === 'system' &&
      (message as { subtype?: string }).subtype === 'microcompact_boundary'
    ) {
      continue
    }

    if (startIndex === -1) {
      startIndex = i
    }
    endIndex = i
    freedTokens += estimateMessageTokens(message)
    removedUuids.push(message.uuid)

    if (freedTokens >= tokensToRemove) {
      break
    }
  }

  if (startIndex === -1 || endIndex === -1 || removedUuids.length === 0) {
    return null
  }

  return {
    startIndex,
    endIndex,
    removedUuids,
    tokensFreed: freedTokens,
  }
}

function buildBoundaryMessage(
  removedUuids: UUID[],
  tokensFreed: number,
): SnipBoundaryMessage {
  return {
    ...createSystemMessage('Earlier context was trimmed to keep the active turn focused.', 'info'),
    uuid: randomUUID() as UUID,
    snipMetadata: {
      removedUuids,
      removedCount: removedUuids.length,
      tokensFreed,
      createdAt: new Date().toISOString(),
    },
  } as SnipBoundaryMessage
}

function applyBoundary<T extends Message>(
  messages: T[],
  boundary: SnipBoundaryMessage,
): SnipResult<T> {
  const removed = new Set(boundary.snipMetadata.removedUuids)
  const nextMessages = messages.filter(
    message =>
      !removed.has(message.uuid as UUID) && !isSnipBoundaryMessage(message),
  )

  return {
    messages: nextMessages,
    tokensFreed: boundary.snipMetadata.tokensFreed,
    executed: removed.size > 0,
  }
}

export function shouldNudgeForSnips(messages: Message[]): boolean {
  if (!isSnipRuntimeEnabled()) {
    return false
  }

  const effectiveWindow = getEffectiveContextWindowSize(
    process.env.CLAUDE_CODE_MAIN_MODEL ?? 'claude',
  )
  if (estimateTokens(messages) < effectiveWindow * 0.25) {
    return false
  }

  let tokensSinceReset = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!
    if (isCompactBoundary(message) || isSnipBoundaryMessage(message)) {
      break
    }
    const text = getTextPayload(message)
    if (text?.includes(SNIP_NUDGE_TEXT)) {
      break
    }
    tokensSinceReset += estimateMessageTokens(message)
    if (tokensSinceReset >= NUDGE_INTERVAL_TOKENS) {
      return true
    }
  }

  return false
}

export function isSnipMarkerMessage(message: unknown): boolean {
  return (
    !!message &&
    typeof message === 'object' &&
    (message as { type?: string }).type === 'system' &&
    (message as { content?: string }).content === SNIP_NUDGE_TEXT
  )
}

export function snipCompactIfNeeded<T extends Message>(
  messages: T[],
  options?: { force?: boolean },
): SnipResult<T> {
  if (options?.force) {
    const boundary = [...messages]
      .reverse()
      .find(isSnipBoundaryMessage)
    if (!boundary) {
      return {
        messages,
        tokensFreed: 0,
        executed: false,
      }
    }
    return applyBoundary(messages, boundary as SnipBoundaryMessage)
  }

  if (!isSnipRuntimeEnabled()) {
    return {
      messages,
      tokensFreed: 0,
      executed: false,
    }
  }

  const selection = selectSnipRange(messages)
  if (!selection) {
    return {
      messages,
      tokensFreed: 0,
      executed: false,
    }
  }

  const boundaryMessage = buildBoundaryMessage(
    selection.removedUuids,
    selection.tokensFreed,
  ) as T

  const nextMessages = messages.filter(
    message => !selection.removedUuids.includes(message.uuid as UUID),
  )

  return {
    messages: nextMessages,
    tokensFreed: selection.tokensFreed,
    boundaryMessage,
    executed: true,
  }
}
