import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test'

const agentsModuleUrl = new URL('../../src/cli/handlers/agents.ts', import.meta.url)
  .href
const agentDisplayModuleUrl = new URL(
  '../../src/tools/AgentTool/agentDisplay.js',
  import.meta.url,
).href
const loadAgentsDirModuleUrl = new URL(
  '../../src/tools/AgentTool/loadAgentsDir.js',
  import.meta.url,
).href
const cwdModuleUrl = new URL('../../src/utils/cwd.js', import.meta.url).href

let importCounter = 0

async function importFreshAgentsModule() {
  const actualAgentDisplayModule = await import(agentDisplayModuleUrl)
  const actualLoadAgentsDirModule = await import(loadAgentsDirModuleUrl)

  mock.module(agentDisplayModuleUrl, () => ({
    ...actualAgentDisplayModule,
    AGENT_SOURCE_GROUPS: [{ label: 'Built-in agents', source: 'builtin' }],
    compareAgentsByName: (a: { agentType: string }, b: { agentType: string }) =>
      a.agentType.localeCompare(b.agentType),
    getOverrideSourceLabel: () => 'builtin',
    resolveAgentModelDisplay: (agent: { model?: string }) => agent.model ?? '',
    resolveAgentOverrides: () => [
      {
        agentType: 'general-purpose',
        memory: 'workspace',
        model: 'sonnet',
        overriddenBy: undefined,
        source: 'builtin',
      },
    ],
  }))
  mock.module(loadAgentsDirModuleUrl, () => ({
    ...actualLoadAgentsDirModule,
    getActiveAgentsFromList: () => [],
    getAgentDefinitionsWithOverrides: async () => ({ allAgents: [] }),
  }))
  mock.module(cwdModuleUrl, () => ({
    getCwd: () => '/tmp/project',
  }))

  importCounter += 1
  return import(`${agentsModuleUrl}?case=${importCounter}`) as Promise<
    typeof import('../../src/cli/handlers/agents.ts')
  >
}

afterEach(() => {
  mock.restore()
})

describe('agents handler source tests', () => {
  test('prints built-in agents from source handlers without spawning the CLI', async () => {
    const consoleLogSpy = spyOn(console, 'log').mockImplementation(() => {})
    const { agentsHandler } = await importFreshAgentsModule()

    await agentsHandler()

    expect(consoleLogSpy).toHaveBeenNthCalledWith(1, '1 active agents\n')
    expect(consoleLogSpy).toHaveBeenNthCalledWith(
      2,
      'Built-in agents:\n  general-purpose · sonnet · workspace memory',
    )

    consoleLogSpy.mockRestore()
  })
})
