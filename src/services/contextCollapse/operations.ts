import { randomUUID } from 'crypto'
import { getMainLoopModel } from '../../utils/model/model.js'
import { createUserMessage } from '../../utils/messages.js'
import {
  recordContextCollapseCommit,
  recordContextCollapseSnapshot,
} from '../../utils/sessionStorage.js'
import { tokenCountWithEstimation } from '../../utils/tokens.js'
import type {
  ContextCollapseCommitEntry,
  ContextCollapseSnapshotEntry,
} from '../../types/logs.js'
import type { Message } from '../../types/message.js'
import { getEffectiveContextWindowSize } from '../compact/autoCompact.js'

const PROTECTED_TAIL_MESSAGES = 10
const STAGE_THRESHOLD_RATIO = 0.82
const COMMIT_THRESHOLD_RATIO = 0.9
const TARGET_RATIO = 0.72
const MIN_COLLAPSE_TOKENS = 12_000
const EMPTY_SPAWN_WARNING_THRESHOLD = 3
const MAX_SUMMARY_CHARS = 320

export type CollapseHealth = {
  totalErrors: number
  totalSpawns: number
  totalEmptySpawns: number
  emptySpawnWarningEmitted: boolean
  lastError?: string
}

export type CollapseStats = {
  collapsedSpans: number
  collapsedMessages: number
  stagedSpans: number
  health: CollapseHealth
}

export type StagedCollapse = {
  startUuid: string
  endUuid: string
  summary: string
  risk: number
  stagedAt: number
}

type CommittedCollapse = {
  collapseId: string
  summaryUuid: string
  summaryContent: string
  summary: string
  firstArchivedUuid: string
  lastArchivedUuid: string
}

type CollapseStore = {
  commits: CommittedCollapse[]
  staged: StagedCollapse[]
  armed: boolean
  lastSpawnTokens: number
  collapsedMessages: number
  health: CollapseHealth
  listeners: Set<() => void>
  nextId: bigint
}

const store: CollapseStore = {
  commits: [],
  staged: [],
  armed: false,
  lastSpawnTokens: 0,
  collapsedMessages: 0,
  health: {
    totalErrors: 0,
    totalSpawns: 0,
    totalEmptySpawns: 0,
    emptySpawnWarningEmitted: false,
  },
  listeners: new Set(),
  nextId: 0n,
}

function emitChange(): void {
  for (const listener of store.listeners) {
    listener()
  }
}

function toCollapseId(value: bigint): string {
  return value.toString().padStart(16, '0')
}

function nextCollapseId(): string {
  store.nextId += 1n
  return toCollapseId(store.nextId)
}

function reseedFromCommits(commits: CommittedCollapse[]): void {
  let max = 0n
  for (const commit of commits) {
    try {
      const parsed = BigInt(commit.collapseId)
      if (parsed > max) {
        max = parsed
      }
    } catch {
      // Ignore malformed restored IDs.
    }
  }
  store.nextId = max
}

function getMessageUuid(message: Message): string {
  return (message as { uuid: string }).uuid
}

function estimateTokens(messages: Message[]): number {
  return tokenCountWithEstimation(messages)
}

function estimateMessageTokens(message: Message): number {
  return estimateTokens([message])
}

function escapeXml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function makeSummaryMessage(commit: CommittedCollapse): Message {
  return {
    ...createUserMessage({
      content: commit.summaryContent,
      isMeta: true,
    }),
    uuid: commit.summaryUuid,
  } as Message
}

function isCollapsedSummary(message: Message): boolean {
  return (
    message.type === 'user' &&
    typeof (message as { isMeta?: boolean }).isMeta === 'boolean' &&
    !!(message as { isMeta?: boolean }).isMeta &&
    typeof (message as { message?: { content?: unknown } }).message?.content ===
      'string' &&
    ((message as { message: { content: string } }).message.content.startsWith(
      '<collapsed id="',
    ) ||
      (message as { message: { content: string } }).message.content.startsWith(
        '<collapsed ',
      ))
  )
}

function findMessageIndexByUuid(messages: Message[], uuid: string): number {
  return messages.findIndex(message => getMessageUuid(message) === uuid)
}

function clampSummary(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= MAX_SUMMARY_CHARS) {
    return normalized
  }
  return `${normalized.slice(0, MAX_SUMMARY_CHARS - 1).trimEnd()}…`
}

function describeMessage(message: Message): string | null {
  if (message.type === 'attachment') {
    const attachment = (message as { attachment?: { type?: string } }).attachment
    return attachment?.type ? `attachment:${attachment.type}` : 'attachment'
  }

  if (message.type === 'system') {
    return null
  }

  const payload = (message as { message?: { content?: unknown } }).message?.content
  if (typeof payload === 'string') {
    return payload.trim()
  }
  if (!Array.isArray(payload)) {
    return null
  }

  const parts: string[] = []
  for (const block of payload) {
    if (!block || typeof block !== 'object') continue
    const type = (block as { type?: string }).type
    if (type === 'text' && typeof (block as { text?: string }).text === 'string') {
      const text = (block as { text: string }).text.trim()
      if (text) {
        parts.push(text)
      }
    } else if (
      type === 'tool_use' &&
      typeof (block as { name?: string }).name === 'string'
    ) {
      parts.push(`tool:${(block as { name: string }).name}`)
    } else if (
      type === 'tool_result' &&
      typeof (block as { tool_use_id?: string }).tool_use_id === 'string'
    ) {
      parts.push(`result:${(block as { tool_use_id: string }).tool_use_id}`)
    }
    if (parts.length >= 2) {
      break
    }
  }

  return parts.length > 0 ? parts.join(' · ') : null
}

function summarizeRange(messages: Message[]): string {
  const previews = messages
    .map(describeMessage)
    .filter((value): value is string => Boolean(value))
    .slice(0, 3)
    .map(text => clampSummary(text))

  const userCount = messages.filter(message => message.type === 'user').length
  const assistantCount = messages.filter(
    message => message.type === 'assistant',
  ).length
  const attachmentCount = messages.filter(
    message => message.type === 'attachment',
  ).length

  const summaryBits = [
    `${messages.length} earlier messages`,
    userCount > 0 ? `${userCount} user` : null,
    assistantCount > 0 ? `${assistantCount} assistant` : null,
    attachmentCount > 0 ? `${attachmentCount} attachment` : null,
  ].filter((value): value is string => value !== null)

  const prefix = `Archived ${summaryBits.join(', ')}.`
  if (previews.length === 0) {
    return prefix
  }
  return `${prefix} Highlights: ${previews.join(' | ')}`
}

function createSummaryContent(collapseId: string, summary: string): string {
  return `<collapsed id="${collapseId}">${escapeXml(summary)}</collapsed>`
}

function projectSingleCommit(messages: Message[], commit: CommittedCollapse): {
  messages: Message[]
  archivedCount: number
} {
  if (findMessageIndexByUuid(messages, commit.summaryUuid) !== -1) {
    return { messages, archivedCount: 0 }
  }

  const startIndex = findMessageIndexByUuid(messages, commit.firstArchivedUuid)
  const endIndex = findMessageIndexByUuid(messages, commit.lastArchivedUuid)
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    return { messages, archivedCount: 0 }
  }

  const next = [...messages]
  const archivedCount = endIndex - startIndex + 1
  next.splice(startIndex, archivedCount, makeSummaryMessage(commit))
  return { messages: next, archivedCount }
}

function persistSnapshot(): Promise<void> {
  return recordContextCollapseSnapshot({
    staged: store.staged.map(entry => ({
      startUuid: entry.startUuid,
      endUuid: entry.endUuid,
      summary: entry.summary,
      risk: entry.risk,
      stagedAt: entry.stagedAt,
    })),
    armed: store.armed,
    lastSpawnTokens: store.lastSpawnTokens,
  }).catch(error => {
    setHealthError(error)
  })
}

function setHealthError(error: unknown): void {
  store.health.totalErrors += 1
  store.health.lastError =
    error instanceof Error ? error.message : String(error ?? 'Unknown error')
}

function selectStageCandidate(messages: Message[], model: string): StagedCollapse | null {
  if (messages.length <= PROTECTED_TAIL_MESSAGES + 1) {
    return null
  }

  const effectiveWindow = getEffectiveContextWindowSize(model)
  const totalTokens = estimateTokens(messages)
  if (totalTokens < effectiveWindow * STAGE_THRESHOLD_RATIO) {
    return null
  }

  const targetTokens = Math.floor(effectiveWindow * TARGET_RATIO)
  const tokensToRemove = Math.max(
    MIN_COLLAPSE_TOKENS,
    totalTokens - targetTokens,
  )
  const lastRemovableIndex = Math.max(
    0,
    messages.length - PROTECTED_TAIL_MESSAGES - 1,
  )

  let startIndex = -1
  let endIndex = -1
  let freedTokens = 0
  const range: Message[] = []

  for (let i = 0; i <= lastRemovableIndex; i++) {
    const message = messages[i]!
    if (
      message.type === 'system' &&
      !isCollapsedSummary(message) &&
      (message as { subtype?: string }).subtype !== 'informational'
    ) {
      continue
    }
    if (message.type === 'progress') {
      continue
    }

    if (startIndex === -1) {
      startIndex = i
    }
    endIndex = i
    range.push(message)
    freedTokens += estimateMessageTokens(message)
    if (freedTokens >= tokensToRemove) {
      break
    }
  }

  if (startIndex === -1 || endIndex === -1 || range.length === 0) {
    return null
  }

  return {
    startUuid: getMessageUuid(messages[startIndex]!),
    endUuid: getMessageUuid(messages[endIndex]!),
    summary: summarizeRange(range),
    risk: Math.min(1, freedTokens / effectiveWindow),
    stagedAt: Date.now(),
  }
}

function commitStagedCollapse(collapse: StagedCollapse): CommittedCollapse {
  const collapseId = nextCollapseId()
  return {
    collapseId,
    summaryUuid: randomUUID(),
    summaryContent: createSummaryContent(collapseId, collapse.summary),
    summary: collapse.summary,
    firstArchivedUuid: collapse.startUuid,
    lastArchivedUuid: collapse.endUuid,
  }
}

export function getStats(): CollapseStats {
  return {
    collapsedSpans: store.commits.length,
    collapsedMessages: store.collapsedMessages,
    stagedSpans: store.staged.length,
    health: { ...store.health },
  }
}

export function subscribe(listener: () => void): () => void {
  store.listeners.add(listener)
  return () => {
    store.listeners.delete(listener)
  }
}

export function resetStore(): void {
  store.commits.length = 0
  store.staged.length = 0
  store.armed = false
  store.lastSpawnTokens = 0
  store.collapsedMessages = 0
  store.health = {
    totalErrors: 0,
    totalSpawns: 0,
    totalEmptySpawns: 0,
    emptySpawnWarningEmitted: false,
  }
  store.nextId = 0n
  emitChange()
}

export function hydrateStoreFromEntries(
  commits: ContextCollapseCommitEntry[],
  snapshot?: ContextCollapseSnapshotEntry,
): void {
  store.commits = commits.map(commit => ({
    collapseId: commit.collapseId,
    summaryUuid: commit.summaryUuid,
    summaryContent: commit.summaryContent,
    summary: commit.summary,
    firstArchivedUuid: commit.firstArchivedUuid,
    lastArchivedUuid: commit.lastArchivedUuid,
  }))
  store.staged =
    snapshot?.staged.map(entry => ({
      startUuid: entry.startUuid,
      endUuid: entry.endUuid,
      summary: entry.summary,
      risk: entry.risk,
      stagedAt: entry.stagedAt,
    })) ?? []
  store.armed = snapshot?.armed ?? false
  store.lastSpawnTokens = snapshot?.lastSpawnTokens ?? 0
  store.collapsedMessages = 0
  reseedFromCommits(store.commits)
  emitChange()
}

export function projectView(messages: Message[]): Message[] {
  let projected = [...messages]
  let collapsedMessages = 0
  for (const commit of store.commits) {
    const result = projectSingleCommit(projected, commit)
    projected = result.messages
    collapsedMessages += result.archivedCount
  }
  store.collapsedMessages = collapsedMessages
  return projected
}

export function stageCollapseIfNeeded(
  messages: Message[],
  model = getMainLoopModel(),
): { staged: boolean; messages: Message[] } {
  const projected = projectView(messages)
  const effectiveWindow = getEffectiveContextWindowSize(model)
  const totalTokens = estimateTokens(projected)

  store.lastSpawnTokens = totalTokens
  store.armed = totalTokens >= effectiveWindow * STAGE_THRESHOLD_RATIO

  if (!store.armed) {
    if (store.staged.length > 0) {
      store.staged.length = 0
      void persistSnapshot()
      emitChange()
    }
    return { staged: false, messages: projected }
  }

  if (store.staged.length > 0) {
    return { staged: false, messages: projected }
  }

  const candidate = selectStageCandidate(projected, model)
  store.health.totalSpawns += 1

  if (!candidate) {
    store.health.totalEmptySpawns += 1
    store.health.emptySpawnWarningEmitted =
      store.health.totalEmptySpawns >= EMPTY_SPAWN_WARNING_THRESHOLD
    void persistSnapshot()
    emitChange()
    return { staged: false, messages: projected }
  }

  store.health.totalEmptySpawns = 0
  store.health.emptySpawnWarningEmitted = false
  store.staged.push(candidate)
  void persistSnapshot()
  emitChange()
  return { staged: true, messages: projected }
}

function commitStagedInternal(
  messages: Message[],
  options?: { forceAll?: boolean; model?: string },
): {
  messages: Message[]
  committed: number
  writes: Promise<void>[]
} {
  let projected = projectView(messages)
  const model = options?.model ?? getMainLoopModel()
  const effectiveWindow = getEffectiveContextWindowSize(model)
  let committed = 0
  const writes: Promise<void>[] = []

  while (store.staged.length > 0) {
    const shouldCommit =
      options?.forceAll ||
      estimateTokens(projected) >= effectiveWindow * COMMIT_THRESHOLD_RATIO

    if (!shouldCommit) {
      break
    }

    const staged = store.staged.shift()!
    const commit = commitStagedCollapse(staged)
    store.commits.push(commit)

    writes.push(
      recordContextCollapseCommit({
        collapseId: commit.collapseId,
        summaryUuid: commit.summaryUuid,
        summaryContent: commit.summaryContent,
        summary: commit.summary,
        firstArchivedUuid: commit.firstArchivedUuid,
        lastArchivedUuid: commit.lastArchivedUuid,
      }).catch(error => {
        setHealthError(error)
      }),
    )

    committed += 1
    projected = projectView(projected)
  }

  writes.push(persistSnapshot())
  emitChange()
  return { messages: projected, committed, writes }
}

export async function commitStagedIfNeeded(
  messages: Message[],
  options?: { forceAll?: boolean; model?: string },
): Promise<{ messages: Message[]; committed: number }> {
  const result = commitStagedInternal(messages, options)
  await Promise.all(result.writes)
  return {
    messages: result.messages,
    committed: result.committed,
  }
}

export function commitStagedSyncIfNeeded(
  messages: Message[],
  options?: { forceAll?: boolean; model?: string },
): { messages: Message[]; committed: number } {
  const result = commitStagedInternal(messages, options)
  void Promise.allSettled(result.writes)
  return {
    messages: result.messages,
    committed: result.committed,
  }
}
