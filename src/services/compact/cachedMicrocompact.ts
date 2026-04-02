import { isEnvTruthy } from '../../utils/envUtils.js'

type CacheEditingConfig = {
  enabled: boolean
  triggerThreshold: number
  keepRecent: number
  supportedModels: string[]
  systemPromptSuggestSummaries: boolean
}

type ToolGroup = {
  toolUseIds: string[]
  sentToAPI: boolean
}

export type CacheEditsBlock = {
  type: 'cache_edits'
  edits: Array<{ type: 'delete'; cache_reference: string }>
}

export type PinnedCacheEdits = {
  userMessageIndex: number
  block: CacheEditsBlock
}

export type CachedMCState = {
  registeredTools: Set<string>
  toolOrder: string[]
  deletedRefs: Set<string>
  pinnedEdits: PinnedCacheEdits[]
  sentToAPI: Set<string>
  groups: ToolGroup[]
}

const DEFAULT_SUPPORTED_MODELS = ['sonnet', 'opus', 'haiku']

function parseIntegerEnv(name: string, fallback: number): number {
  const value = process.env[name]
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function parseSupportedModels(): string[] {
  const raw = process.env.CLAUDE_CODE_CACHED_MC_MODELS
  if (!raw) {
    return DEFAULT_SUPPORTED_MODELS
  }
  return raw
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
}

export function getCachedMCConfig(): CacheEditingConfig {
  const enabled =
    process.env.USER_TYPE === 'ant' ||
    isEnvTruthy(process.env.CLAUDE_CODE_CACHED_MICROCOMPACT)

  return {
    enabled,
    triggerThreshold: parseIntegerEnv(
      'CLAUDE_CODE_CACHED_MC_TRIGGER_THRESHOLD',
      12,
    ),
    keepRecent: parseIntegerEnv('CLAUDE_CODE_CACHED_MC_KEEP_RECENT', 6),
    supportedModels: parseSupportedModels(),
    systemPromptSuggestSummaries: !isEnvTruthy(
      process.env.CLAUDE_CODE_DISABLE_CACHED_MC_SUMMARY_HINTS,
    ),
  }
}

export function createCachedMCState(): CachedMCState {
  return {
    registeredTools: new Set(),
    toolOrder: [],
    deletedRefs: new Set(),
    pinnedEdits: [],
    sentToAPI: new Set(),
    groups: [],
  }
}

export function resetCachedMCState(state: CachedMCState): void {
  state.registeredTools.clear()
  state.toolOrder.length = 0
  state.deletedRefs.clear()
  state.pinnedEdits.length = 0
  state.sentToAPI.clear()
  state.groups.length = 0
}

export function markToolsSentToAPI(state: CachedMCState): void {
  for (const group of state.groups) {
    if (group.sentToAPI) continue
    group.sentToAPI = true
    for (const toolUseId of group.toolUseIds) {
      state.sentToAPI.add(toolUseId)
    }
  }
}

export function isCachedMicrocompactEnabled(): boolean {
  return getCachedMCConfig().enabled
}

export function isModelSupportedForCacheEditing(model: string): boolean {
  const patterns = getCachedMCConfig().supportedModels
  return patterns.some(pattern => model.includes(pattern))
}

export function registerToolResult(
  state: CachedMCState,
  toolUseId: string,
): void {
  if (state.registeredTools.has(toolUseId)) {
    return
  }
  state.registeredTools.add(toolUseId)
  state.toolOrder.push(toolUseId)
}

export function registerToolMessage(
  state: CachedMCState,
  toolUseIds: string[],
): void {
  if (toolUseIds.length === 0) {
    return
  }
  state.groups.push({
    toolUseIds: [...toolUseIds],
    sentToAPI: false,
  })
}

export function getToolResultsToDelete(state: CachedMCState): string[] {
  const config = getCachedMCConfig()
  const eligible = state.toolOrder.filter(
    toolUseId =>
      state.sentToAPI.has(toolUseId) && !state.deletedRefs.has(toolUseId),
  )

  if (eligible.length < config.triggerThreshold) {
    return []
  }

  const keepRecent = Math.max(1, config.keepRecent)
  const toDelete = eligible.slice(0, Math.max(0, eligible.length - keepRecent))
  for (const toolUseId of toDelete) {
    state.deletedRefs.add(toolUseId)
  }
  return toDelete
}

export function createCacheEditsBlock(
  _state: CachedMCState,
  toolUseIds: string[],
): CacheEditsBlock | null {
  if (toolUseIds.length === 0) {
    return null
  }

  return {
    type: 'cache_edits',
    edits: toolUseIds.map(toolUseId => ({
      type: 'delete',
      cache_reference: toolUseId,
    })),
  }
}
