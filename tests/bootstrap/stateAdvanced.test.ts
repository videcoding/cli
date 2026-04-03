import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import {
  addInvokedSkill,
  addSessionCronTask,
  addToToolDuration,
  addToTotalCostState,
  addToTotalDurationState,
  addToTotalLinesChanged,
  addToTurnClassifierDuration,
  addToTurnHookDuration,
  clearBetaHeaderLatches,
  clearInvokedSkills,
  clearInvokedSkillsForAgent,
  clearRegisteredHooks,
  clearRegisteredPluginHooks,
  clearSystemPromptSectionState,
  consumePostCompaction,
  flushInteractionTime,
  getAdditionalDirectoriesForClaudeMd,
  getAfkModeHeaderLatched,
  getAllowedChannels,
  getAllowedSettingSources,
  getApiKeyFromFd,
  getBudgetContinuationCount,
  getCacheEditingHeaderLatched,
  getCachedClaudeMdContent,
  getChromeFlagOverride,
  getClientType,
  getCodeEditToolDecisionCounter,
  getCommitCounter,
  getCurrentTurnTokenBudget,
  getCwdState,
  getDirectConnectServerUrl,
  getEventLogger,
  getFastModeHeaderLatched,
  getFlagSettingsInline,
  getFlagSettingsPath,
  getHasDevChannels,
  getInitJsonSchema,
  getInlinePlugins,
  getInvokedSkills,
  getInvokedSkillsForAgent,
  getIsInteractive,
  getIsRemoteMode,
  getIsScrollDraining,
  getKairosActive,
  getLastApiCompletionTimestamp,
  getLastClassifierRequests,
  getLastEmittedDate,
  getLastInteractionTime,
  getLastMainRequestId,
  getLocCounter,
  getMainLoopModelOverride,
  getMainThreadAgentType,
  getMeter,
  getMeterProvider,
  getModelUsage,
  getOauthTokenFromFd,
  getOriginalCwd,
  getParentSessionId,
  getPlanSlugCache,
  getPrCounter,
  getProjectRoot,
  getPromptCache1hAllowlist,
  getPromptCache1hEligible,
  getPromptId,
  getQuestionPreviewFormat,
  getRegisteredHooks,
  getScheduledTasksEnabled,
  getSdkAgentProgressSummariesEnabled,
  getSessionBypassPermissionsMode,
  getSessionCounter,
  getSessionCronTasks,
  getSessionId,
  getSessionIngressToken,
  getSessionProjectDir,
  getSessionSource,
  getSessionTrustAccepted,
  getStatsStore,
  getStrictToolResultPairing,
  getSystemPromptSectionCache,
  getTeleportedSessionInfo,
  getThinkingClearLatched,
  getTotalAPIDuration,
  getTotalAPIDurationWithoutRetries,
  getTotalCacheCreationInputTokens,
  getTotalCacheReadInputTokens,
  getTotalCostUSD,
  getTotalDuration,
  getTotalInputTokens,
  getTotalLinesAdded,
  getTotalLinesRemoved,
  getTotalOutputTokens,
  getTotalToolDuration,
  getTotalWebSearchRequests,
  getTracerProvider,
  getTurnClassifierCount,
  getTurnClassifierDurationMs,
  getTurnHookCount,
  getTurnHookDurationMs,
  getTurnOutputTokens,
  getTurnToolCount,
  getTurnToolDurationMs,
  getUseCoworkPlugins,
  getUsageForModel,
  getUserMsgOptIn,
  handleAutoModeTransition,
  handlePlanModeTransition,
  hasExitedPlanModeInSession,
  hasShownLspRecommendationThisSession,
  hasUnknownModelCost,
  incrementBudgetContinuationCount,
  isSessionPersistenceDisabled,
  markFirstTeleportMessageLogged,
  markPostCompaction,
  markScrollActivity,
  needsAutoModeExitAttachment,
  needsPlanModeExitAttachment,
  onSessionSwitch,
  preferThirdPartyAuthentication,
  regenerateSessionId,
  registerHookCallbacks,
  removeSessionCronTasks,
  resetCostState,
  resetSdkInitState,
  resetStateForTests,
  resetTurnClassifierDuration,
  resetTurnHookDuration,
  resetTurnToolDuration,
  setAdditionalDirectoriesForClaudeMd,
  setAfkModeHeaderLatched,
  setAllowedChannels,
  setAllowedSettingSources,
  setApiKeyFromFd,
  setCacheEditingHeaderLatched,
  setCachedClaudeMdContent,
  setChromeFlagOverride,
  setClientType,
  setCwdState,
  setDirectConnectServerUrl,
  setEventLogger,
  setFastModeHeaderLatched,
  setFlagSettingsInline,
  setFlagSettingsPath,
  setHasDevChannels,
  setHasExitedPlanMode,
  setHasUnknownModelCost,
  setInitJsonSchema,
  setInlinePlugins,
  setIsInteractive,
  setIsRemoteMode,
  setKairosActive,
  setLastApiCompletionTimestamp,
  setLastClassifierRequests,
  setLastEmittedDate,
  setLastMainRequestId,
  setMainLoopModelOverride,
  setMainThreadAgentType,
  setMeter,
  setMeterProvider,
  setNeedsAutoModeExitAttachment,
  setNeedsPlanModeExitAttachment,
  setOauthTokenFromFd,
  setOriginalCwd,
  setCostStateForRestore,
  setProjectRoot,
  setPromptCache1hAllowlist,
  setPromptCache1hEligible,
  setPromptId,
  setQuestionPreviewFormat,
  setSdkAgentProgressSummariesEnabled,
  setSessionBypassPermissionsMode,
  setSessionIngressToken,
  setSessionPersistenceDisabled,
  setSessionSource,
  setSessionTrustAccepted,
  setStatsStore,
  setStrictToolResultPairing,
  setSystemPromptSectionCacheEntry,
  setTeleportedSessionInfo,
  setThinkingClearLatched,
  setTracerProvider,
  setUseCoworkPlugins,
  setUserMsgOptIn,
  setFastModeHeaderLatched as setFastModeLatched,
  snapshotOutputTokensForTurn,
  switchSession,
  updateLastInteractionTime,
  waitForScrollIdle,
} from '../../src/bootstrap/state.ts'
import {
  getSessionSettingsCache,
  setSessionSettingsCache,
} from '../../src/utils/settings/settingsCache.ts'

const originalEnv = { ...process.env }

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key]
    }
  }
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

describe('bootstrap state advanced behavior', () => {
  beforeEach(() => {
    restoreEnv()
    resetStateForTests()
  })

  afterEach(() => {
    restoreEnv()
    resetStateForTests()
  })

  test('switches sessions, clears plan slugs, and normalizes cwd state', () => {
    const startingSessionId = getSessionId()
    const switchedTo: string[] = []
    const unsubscribe = onSessionSwitch(id => {
      switchedTo.push(id)
    })

    getPlanSlugCache().set(startingSessionId, 'draft-plan')
    setOriginalCwd('Cafe\u0301')
    setProjectRoot('Proje\u0301t')
    setCwdState('Worktre\u0301e')
    setDirectConnectServerUrl('https://remote.example.com')

    expect(getOriginalCwd()).toBe('Caf\u00e9')
    expect(getProjectRoot()).toBe('Proj\u00e9t')
    expect(getCwdState()).toBe('Worktr\u00e9e')
    expect(getDirectConnectServerUrl()).toBe('https://remote.example.com')

    switchSession('session-2' as never, '/tmp/project-a')
    expect(getSessionProjectDir()).toBe('/tmp/project-a')
    expect(switchedTo).toEqual(['session-2'])
    expect(getPlanSlugCache().has(startingSessionId)).toBe(false)

    const regenerated = regenerateSessionId({ setCurrentAsParent: true })
    expect(regenerated).not.toBe('session-2')
    expect(getParentSessionId()).toBe('session-2')
    expect(getSessionProjectDir()).toBeNull()

    unsubscribe()
  })

  test('tracks costs, token budgets, and restore/reset state transitions', () => {
    const dateNowSpy = spyOn(Date, 'now')
    dateNowSpy.mockReturnValue(10_000)
    resetCostState()

    addToTotalDurationState(120, 90)
    addToToolDuration(30)
    addToTurnHookDuration(7)
    addToTurnClassifierDuration(11)
    addToTotalLinesChanged(14, 4)

    addToTotalCostState(
      1.25,
      {
        inputTokens: 10,
        outputTokens: 5,
        cacheReadInputTokens: 2,
        cacheCreationInputTokens: 1,
        webSearchRequests: 0,
        costUSD: 1.25,
        contextWindow: 200_000,
        maxOutputTokens: 8_192,
      } as never,
      'model-a',
    )
    addToTotalCostState(
      2,
      {
        inputTokens: 7,
        outputTokens: 11,
        cacheReadInputTokens: 3,
        cacheCreationInputTokens: 4,
        webSearchRequests: 2,
        costUSD: 2,
        contextWindow: 1_000_000,
        maxOutputTokens: 16_384,
      } as never,
      'model-b',
    )

    expect(getTotalCostUSD()).toBe(3.25)
    expect(getTotalAPIDuration()).toBe(120)
    expect(getTotalAPIDurationWithoutRetries()).toBe(90)
    expect(getTotalToolDuration()).toBe(30)
    expect(getTurnHookDurationMs()).toBe(7)
    expect(getTurnHookCount()).toBe(1)
    expect(getTurnToolDurationMs()).toBe(30)
    expect(getTurnToolCount()).toBe(1)
    expect(getTurnClassifierDurationMs()).toBe(11)
    expect(getTurnClassifierCount()).toBe(1)
    expect(getTotalLinesAdded()).toBe(14)
    expect(getTotalLinesRemoved()).toBe(4)
    expect(getTotalInputTokens()).toBe(17)
    expect(getTotalOutputTokens()).toBe(16)
    expect(getTotalCacheReadInputTokens()).toBe(5)
    expect(getTotalCacheCreationInputTokens()).toBe(5)
    expect(getTotalWebSearchRequests()).toBe(2)
    expect(getUsageForModel('model-a')?.costUSD).toBe(1.25)
    expect(Object.keys(getModelUsage())).toEqual(['model-a', 'model-b'])

    snapshotOutputTokensForTurn(500)
    expect(getCurrentTurnTokenBudget()).toBe(500)
    addToTotalCostState(
      0.5,
      {
        inputTokens: 0,
        outputTokens: 4,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        webSearchRequests: 0,
        costUSD: 0.5,
        contextWindow: 200_000,
        maxOutputTokens: 8_192,
      } as never,
      'model-c',
    )
    expect(getTurnOutputTokens()).toBe(4)
    expect(getBudgetContinuationCount()).toBe(0)
    incrementBudgetContinuationCount()
    expect(getBudgetContinuationCount()).toBe(1)

    setHasUnknownModelCost()
    expect(hasUnknownModelCost()).toBe(true)
    setLastMainRequestId('req-123')
    setLastApiCompletionTimestamp(9_000)
    markPostCompaction()
    expect(getLastMainRequestId()).toBe('req-123')
    expect(getLastApiCompletionTimestamp()).toBe(9_000)
    expect(consumePostCompaction()).toBe(true)
    expect(consumePostCompaction()).toBe(false)

    dateNowSpy.mockReturnValue(12_000)
    expect(getTotalDuration()).toBeGreaterThanOrEqual(0)

    resetTurnHookDuration()
    resetTurnToolDuration()
    resetTurnClassifierDuration()
    expect(getTurnHookDurationMs()).toBe(0)
    expect(getTurnToolDurationMs()).toBe(0)
    expect(getTurnClassifierDurationMs()).toBe(0)

    setPromptId('prompt-before-reset')
    dateNowSpy.mockReturnValue(20_000)
    resetCostState()
    expect(getTotalCostUSD()).toBe(0)
    expect(getModelUsage()).toEqual({})
    expect(getPromptId()).toBeNull()

    dateNowSpy.mockReturnValue(30_000)
    setCostStateForRestore({
      totalCostUSD: 9,
      totalAPIDuration: 80,
      totalAPIDurationWithoutRetries: 70,
      totalToolDuration: 60,
      totalLinesAdded: 3,
      totalLinesRemoved: 2,
      lastDuration: 500,
      modelUsage: {
        restored: {
          inputTokens: 1,
          outputTokens: 2,
          cacheReadInputTokens: 3,
          cacheCreationInputTokens: 4,
          webSearchRequests: 5,
          costUSD: 6,
          contextWindow: 7,
          maxOutputTokens: 8,
        },
      } as never,
    })
    expect(getTotalCostUSD()).toBe(9)
    expect(getTotalDuration()).toBe(500)
    expect(getUsageForModel('restored')?.webSearchRequests).toBe(5)

    dateNowSpy.mockRestore()
  })

  test('batches interaction timestamps and waits for scroll drain to settle', async () => {
    const dateNowSpy = spyOn(Date, 'now')
    const initial = getLastInteractionTime()

    dateNowSpy.mockReturnValue(111)
    updateLastInteractionTime()
    expect(getLastInteractionTime()).toBe(initial)

    flushInteractionTime()
    expect(getLastInteractionTime()).toBe(111)

    dateNowSpy.mockReturnValue(222)
    updateLastInteractionTime(true)
    expect(getLastInteractionTime()).toBe(222)

    markScrollActivity()
    expect(getIsScrollDraining()).toBe(true)
    await waitForScrollIdle()
    expect(getIsScrollDraining()).toBe(false)

    dateNowSpy.mockRestore()
  })

  test('stores telemetry objects and session-level preferences', () => {
    const createdCounters: string[] = []
    const meter = { name: 'meter' } as never
    const sessionCounter = { add() {} }

    setMeter(meter, name => {
      createdCounters.push(name)
      return sessionCounter
    })
    setStatsStore({ observe() {} })
    setEventLogger({ emit() {} } as never)
    setMeterProvider({} as never)
    setTracerProvider({} as never)
    setIsInteractive(false)
    setClientType('sdk-ts')
    setSdkAgentProgressSummariesEnabled(true)
    setKairosActive(true)
    setStrictToolResultPairing(true)
    setUserMsgOptIn(true)
    setSessionSource('resume')
    setQuestionPreviewFormat('html')
    setFlagSettingsPath('/tmp/settings.json')
    setFlagSettingsInline({ model: 'sonnet' })
    setSessionIngressToken('session-token')
    setOauthTokenFromFd('oauth-token')
    setApiKeyFromFd('api-key')
    setInlinePlugins(['lint', 'test'])
    setChromeFlagOverride(false)
    setSessionSettingsCache({ settings: { theme: 'dark' }, errors: [] } as never)
    setUseCoworkPlugins(true)
    setSessionBypassPermissionsMode(true)
    setAllowedSettingSources(['projectSettings', 'userSettings'])
    setSessionTrustAccepted(true)
    setSessionPersistenceDisabled(true)
    setMainLoopModelOverride('claude-opus-4-1' as never)

    expect(getMeter()).toBe(meter)
    expect(createdCounters).toContain('claude_code.session.count')
    expect(createdCounters).toContain('claude_code.active_time.total')
    expect(getSessionCounter()).toBe(sessionCounter)
    expect(getLocCounter()).toBe(sessionCounter)
    expect(getPrCounter()).toBe(sessionCounter)
    expect(getCommitCounter()).toBe(sessionCounter)
    expect(getCodeEditToolDecisionCounter()).toBe(sessionCounter)
    expect(getStatsStore()).not.toBeNull()
    expect(getEventLogger()).not.toBeNull()
    expect(getMeterProvider()).not.toBeNull()
    expect(getTracerProvider()).not.toBeNull()
    expect(getIsInteractive()).toBe(false)
    expect(getClientType()).toBe('sdk-ts')
    expect(preferThirdPartyAuthentication()).toBe(true)

    setClientType('claude-vscode')
    expect(preferThirdPartyAuthentication()).toBe(false)

    expect(getSdkAgentProgressSummariesEnabled()).toBe(true)
    expect(getKairosActive()).toBe(true)
    expect(getStrictToolResultPairing()).toBe(true)
    expect(getUserMsgOptIn()).toBe(true)
    expect(getSessionSource()).toBe('resume')
    expect(getQuestionPreviewFormat()).toBe('html')
    expect(getFlagSettingsPath()).toBe('/tmp/settings.json')
    expect(getFlagSettingsInline()).toEqual({ model: 'sonnet' })
    expect(getSessionIngressToken()).toBe('session-token')
    expect(getOauthTokenFromFd()).toBe('oauth-token')
    expect(getApiKeyFromFd()).toBe('api-key')
    expect(getInlinePlugins()).toEqual(['lint', 'test'])
    expect(getChromeFlagOverride()).toBe(false)
    expect(getUseCoworkPlugins()).toBe(true)
    expect(getSessionSettingsCache()).toBeNull()
    expect(getSessionBypassPermissionsMode()).toBe(true)
    expect(getAllowedSettingSources()).toEqual([
      'projectSettings',
      'userSettings',
    ])
    expect(getSessionTrustAccepted()).toBe(true)
    expect(isSessionPersistenceDisabled()).toBe(true)
    expect(getMainLoopModelOverride()).toBe('claude-opus-4-1')
  })

  test('manages cron tasks, transition attachments, and registered hooks', () => {
    addSessionCronTask({
      id: 'cron-1',
      cron: '* * * * *',
      prompt: 'first',
      createdAt: 1,
    })
    addSessionCronTask({
      id: 'cron-2',
      cron: '0 * * * *',
      prompt: 'second',
      createdAt: 2,
      agentId: 'agent-1',
    })
    expect(getSessionCronTasks()).toHaveLength(2)
    expect(removeSessionCronTasks([])).toBe(0)
    expect(removeSessionCronTasks(['missing'])).toBe(0)
    expect(removeSessionCronTasks(['cron-2'])).toBe(1)
    expect(getSessionCronTasks().map(task => task.id)).toEqual(['cron-1'])

    setNeedsPlanModeExitAttachment(true)
    handlePlanModeTransition('normal', 'plan')
    expect(needsPlanModeExitAttachment()).toBe(false)
    handlePlanModeTransition('plan', 'normal')
    expect(needsPlanModeExitAttachment()).toBe(true)

    setNeedsAutoModeExitAttachment(true)
    handleAutoModeTransition('normal', 'auto')
    expect(needsAutoModeExitAttachment()).toBe(false)
    handleAutoModeTransition('auto', 'normal')
    expect(needsAutoModeExitAttachment()).toBe(true)
    setNeedsAutoModeExitAttachment(false)
    handleAutoModeTransition('auto', 'plan')
    expect(needsAutoModeExitAttachment()).toBe(false)

    setHasExitedPlanMode(true)
    expect(hasExitedPlanModeInSession()).toBe(true)
    expect(hasShownLspRecommendationThisSession()).toBe(false)

    setInitJsonSchema({ type: 'object' })
    registerHookCallbacks({
      Setup: [
        {
          matcher: '*',
          hooks: [{ type: 'callback', callback: async () => ({ continue: true }) }],
        },
      ],
      SessionStart: [
        {
          matcher: '*',
          hooks: [{ type: 'command', command: 'echo setup' }],
          pluginRoot: '/plugins/demo',
          pluginName: 'demo',
          pluginId: 'demo@marketplace',
        },
      ],
    } as never)
    registerHookCallbacks({
      Setup: [
        {
          matcher: '*',
          hooks: [{ type: 'command', command: 'echo plugin' }],
          pluginRoot: '/plugins/demo',
          pluginName: 'demo',
          pluginId: 'demo@marketplace',
        },
      ],
    } as never)

    expect(getInitJsonSchema()).toEqual({ type: 'object' })
    expect(getRegisteredHooks()?.Setup).toHaveLength(2)
    expect(getRegisteredHooks()?.SessionStart).toHaveLength(1)

    clearRegisteredPluginHooks()
    expect(getRegisteredHooks()?.Setup).toHaveLength(1)
    expect(getRegisteredHooks()?.SessionStart).toBeUndefined()

    clearRegisteredHooks()
    expect(getRegisteredHooks()).toBeNull()

    resetSdkInitState()
    expect(getInitJsonSchema()).toBeNull()
  })

  test('tracks invoked skills, teleported state, and prompt cache flags', () => {
    const dateNowSpy = spyOn(Date, 'now')
    dateNowSpy.mockReturnValueOnce(100)
    addInvokedSkill('shell', '/skills/shell', 'shell content')
    dateNowSpy.mockReturnValueOnce(200)
    addInvokedSkill('git', '/skills/git', 'git content', 'agent-1')
    dateNowSpy.mockReturnValueOnce(300)
    addInvokedSkill('lint', '/skills/lint', 'lint content', 'agent-2')

    expect(getInvokedSkills().size).toBe(3)
    expect(getInvokedSkillsForAgent(null).size).toBe(1)
    expect(getInvokedSkillsForAgent('agent-1').size).toBe(1)

    clearInvokedSkills(new Set(['agent-2']))
    expect(getInvokedSkills().size).toBe(1)
    expect(getInvokedSkillsForAgent('agent-2').size).toBe(1)

    clearInvokedSkillsForAgent('agent-2')
    expect(getInvokedSkills().size).toBe(0)

    setTeleportedSessionInfo({ sessionId: 'teleported-session' })
    expect(getTeleportedSessionInfo()).toEqual({
      isTeleported: true,
      hasLoggedFirstMessage: false,
      sessionId: 'teleported-session',
    })
    markFirstTeleportMessageLogged()
    expect(getTeleportedSessionInfo()?.hasLoggedFirstMessage).toBe(true)

    setCachedClaudeMdContent('# CLAUDE.md')
    setLastClassifierRequests([{ requestId: 1 }])
    setSystemPromptSectionCacheEntry('tools', 'rendered section')
    setLastEmittedDate('2026-04-03')
    setAdditionalDirectoriesForClaudeMd(['/tmp/a', '/tmp/b'])
    setAllowedChannels([{ kind: 'server', name: 'demo' }])
    setHasDevChannels(true)
    setPromptCache1hAllowlist(['repo-a'])
    setPromptCache1hEligible(true)
    setAfkModeHeaderLatched(true)
    setFastModeLatched(true)
    setCacheEditingHeaderLatched(true)
    setThinkingClearLatched(true)
    setPromptId('prompt-1')
    setMainThreadAgentType('reviewer')
    setIsRemoteMode(true)

    expect(getCachedClaudeMdContent()).toBe('# CLAUDE.md')
    expect(getLastClassifierRequests()).toEqual([{ requestId: 1 }])
    expect(getSystemPromptSectionCache().get('tools')).toBe('rendered section')
    expect(getLastEmittedDate()).toBe('2026-04-03')
    expect(getAdditionalDirectoriesForClaudeMd()).toEqual(['/tmp/a', '/tmp/b'])
    expect(getAllowedChannels()).toEqual([{ kind: 'server', name: 'demo' }])
    expect(getHasDevChannels()).toBe(true)
    expect(getPromptCache1hAllowlist()).toEqual(['repo-a'])
    expect(getPromptCache1hEligible()).toBe(true)
    expect(getAfkModeHeaderLatched()).toBe(true)
    expect(getFastModeHeaderLatched()).toBe(true)
    expect(getCacheEditingHeaderLatched()).toBe(true)
    expect(getThinkingClearLatched()).toBe(true)
    expect(getPromptId()).toBe('prompt-1')
    expect(getMainThreadAgentType()).toBe('reviewer')
    expect(getIsRemoteMode()).toBe(true)

    clearSystemPromptSectionState()
    clearBetaHeaderLatches()
    expect(getSystemPromptSectionCache().size).toBe(0)
    expect(getAfkModeHeaderLatched()).toBeNull()
    expect(getFastModeHeaderLatched()).toBeNull()
    expect(getCacheEditingHeaderLatched()).toBeNull()
    expect(getThinkingClearLatched()).toBeNull()

    dateNowSpy.mockRestore()
  })
})
