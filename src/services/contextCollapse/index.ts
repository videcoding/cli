import { isEnvTruthy } from '../../utils/envUtils.js'
import { getMainLoopModel } from '../../utils/model/model.js'
import type { QuerySource } from '../../constants/querySource.js'
import type { ToolUseContext } from '../../Tool.js'
import type { Message } from '../../types/message.js'
import {
  commitStagedIfNeeded,
  commitStagedSyncIfNeeded,
  getStats as getOperationStats,
  projectView,
  resetStore,
  stageCollapseIfNeeded,
  subscribe as subscribeToStore,
} from './operations.js'

function enabledByRuntime(): boolean {
  return (
    process.env.USER_TYPE === 'ant' ||
    isEnvTruthy(process.env.CLAUDE_CONTEXT_COLLAPSE)
  )
}

export function initContextCollapse(): void {}

export function resetContextCollapse(): void {
  resetStore()
}

export function subscribe(listener: () => void): () => void {
  return subscribeToStore(listener)
}

export function getStats() {
  return getOperationStats()
}

export function isContextCollapseEnabled(): boolean {
  return enabledByRuntime()
}

export async function applyCollapsesIfNeeded(
  messages: Message[],
  toolUseContext?: Pick<ToolUseContext, 'options'>,
  _querySource?: QuerySource,
): Promise<{ messages: Message[]; committed: number }> {
  if (!isContextCollapseEnabled()) {
    return { messages, committed: 0 }
  }

  const model = toolUseContext?.options.mainLoopModel ?? getMainLoopModel()
  const staged = stageCollapseIfNeeded(messages, model)
  const committed = await commitStagedIfNeeded(staged.messages, { model })
  return committed
}

export function recoverFromOverflow(
  messages: Message[],
  _querySource?: QuerySource,
): { messages: Message[]; committed: number } {
  if (!isContextCollapseEnabled()) {
    return { messages, committed: 0 }
  }

  return commitStagedSyncIfNeeded(messages, {
    forceAll: true,
  })
}

export function isWithheldPromptTooLong(
  message: unknown,
  isPromptTooLongMessage?: (message: Message) => boolean,
  querySource?: QuerySource,
): boolean {
  if (!isContextCollapseEnabled()) {
    return false
  }
  if (querySource === 'compact' || querySource === 'session_memory') {
    return false
  }
  if (!message || typeof message !== 'object') {
    return false
  }
  if ((message as { type?: string }).type !== 'assistant') {
    return false
  }
  return isPromptTooLongMessage
    ? isPromptTooLongMessage(message as Message)
    : false
}

export function projectCollapsedMessages(messages: Message[]): Message[] {
  return projectView(messages)
}

export function restoreContextCollapseState(): void {}
