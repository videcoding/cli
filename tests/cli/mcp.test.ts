import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test'

const mcpModuleUrl = new URL('../../src/cli/handlers/mcp.tsx', import.meta.url)
  .href
const mcpConfigModuleUrl = new URL(
  '../../src/services/mcp/config.js',
  import.meta.url,
).href

let importCounter = 0

async function importFreshMcpModule() {
  const actualMcpConfigModule = await import(mcpConfigModuleUrl)

  mock.module(mcpConfigModuleUrl, () => ({
    ...actualMcpConfigModule,
    getAllMcpConfigs: async () => ({ servers: {} }),
    getMcpConfigByName: () => undefined,
    getMcpConfigsByScope: () => [],
    addMcpConfig: async () => {},
    removeMcpConfig: async () => {},
  }))

  importCounter += 1
  return import(`${mcpModuleUrl}?case=${importCounter}`) as Promise<
    typeof import('../../src/cli/handlers/mcp.tsx')
  >
}

afterEach(() => {
  mock.restore()
})

describe('mcp handler source tests', () => {
  test('prints the empty-state message from source handlers without spawning the CLI', async () => {
    const consoleLogSpy = spyOn(console, 'log').mockImplementation(() => {})
    const { mcpListHandler } = await importFreshMcpModule()

    await mcpListHandler()

    expect(consoleLogSpy).toHaveBeenCalledWith(
      'No MCP servers configured. Use `claude mcp add` to add a server.',
    )

    consoleLogSpy.mockRestore()
  })
})
