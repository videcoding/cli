import { describe, expect, test } from 'bun:test'
import { runCliIsolated } from './cliTestUtils.ts'

describe('cli isolated state', () => {
  test('shows empty plugin state when HOME is isolated', () => {
    const result = runCliIsolated(['plugin', 'list'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('No plugins installed')
    expect(result.stderr).toBe('')
  })

  test('shows empty mcp state when HOME is isolated', () => {
    const result = runCliIsolated(['mcp', 'list'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('No MCP servers configured')
    expect(result.stderr).toBe('')
  })

  test('reports logged-out auth state when HOME is isolated', () => {
    const result = runCliIsolated(['auth', 'status', '--text'])

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('Not logged in')
    expect(result.stderr).toBe('')
  })

  test('lists built-in agents when HOME is isolated', () => {
    const result = runCliIsolated(['agents'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Built-in agents:')
    expect(result.stdout).toContain('general-purpose')
    expect(result.stderr).toBe('')
  })
})
