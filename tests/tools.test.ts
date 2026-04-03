import { describe, expect, test } from 'bun:test'

function evaluateToolsModule(code: string) {
  const result = Bun.spawnSync({
    cmd: [process.execPath, '--preload', './tests/preload.ts', '-e', code],
    cwd: process.cwd(),
    stdout: 'pipe',
    stderr: 'pipe',
  })

  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString())
  }

  return JSON.parse(result.stdout.toString()) as {
    defaultPreset: string | null
    uppercasePreset: string | null
    invalidPreset: string | null
    hasTestingPermissionTool?: boolean
    filteredNames?: string[]
  }
}

describe('tools registry', () => {
  test('parses supported presets and exposes test-only tools in test mode', () => {
    const result = evaluateToolsModule(`
const { getAllBaseTools, parseToolPreset } = await import('./src/tools.ts')
process.stdout.write(JSON.stringify({
  defaultPreset: parseToolPreset('default'),
  uppercasePreset: parseToolPreset('DEFAULT'),
  invalidPreset: parseToolPreset('unknown'),
  hasTestingPermissionTool: getAllBaseTools().some(tool => tool.name === 'TestingPermission'),
}))
    `)

    expect(result.defaultPreset).toBe('default')
    expect(result.uppercasePreset).toBe('default')
    expect(result.invalidPreset).toBeNull()
    expect(result.hasTestingPermissionTool).toBe(true)
  })

  test('filters built-in and MCP tools with blanket deny rules', () => {
    const result = evaluateToolsModule(`
const { getEmptyToolPermissionContext } = await import('./src/Tool.ts')
const { filterToolsByDenyRules } = await import('./src/tools.ts')
const permissionContext = {
  ...getEmptyToolPermissionContext(),
  alwaysDenyRules: {
    userSettings: ['Bash', 'mcp__github'],
  },
}
const filtered = filterToolsByDenyRules(
  [
    { name: 'Bash' },
    { name: 'Read' },
    { name: 'GitHub Issues', mcpInfo: { serverName: 'github', toolName: 'list_issues' } },
    { name: 'GitLab Issues', mcpInfo: { serverName: 'gitlab', toolName: 'list_issues' } },
  ],
  permissionContext,
)
process.stdout.write(JSON.stringify({
  defaultPreset: null,
  uppercasePreset: null,
  invalidPreset: null,
  filteredNames: filtered.map(tool => tool.name),
}))
    `)

    expect(result.filteredNames).toEqual(['Read', 'GitLab Issues'])
  })
})
