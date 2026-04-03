import { describe, expect, test } from 'bun:test'
import {
  buildMcpToolName,
  extractMcpToolDisplayName,
  getMcpDisplayName,
  getMcpPrefix,
  getToolNameForPermissionCheck,
  mcpInfoFromString,
} from '../../../src/services/mcp/mcpStringUtils.ts'
import { normalizeNameForMCP } from '../../../src/services/mcp/normalization.ts'

describe('mcpStringUtils', () => {
  test('parses MCP tool strings and preserves double underscores in tool names', () => {
    expect(mcpInfoFromString('mcp__github__list_issues')).toEqual({
      serverName: 'github',
      toolName: 'list_issues',
    })
    expect(mcpInfoFromString('mcp__github__issue__comment')).toEqual({
      serverName: 'github',
      toolName: 'issue__comment',
    })
    expect(mcpInfoFromString('mcp__github')).toEqual({
      serverName: 'github',
      toolName: undefined,
    })
    expect(mcpInfoFromString('github__tool')).toBeNull()
    expect(mcpInfoFromString('mcp')).toBeNull()
  })

  test('normalizes server and tool names when building MCP prefixes', () => {
    expect(normalizeNameForMCP('my.server name')).toBe('my_server_name')
    expect(normalizeNameForMCP('claude.ai  repo.name ')).toBe(
      'claude_ai_repo_name',
    )

    expect(getMcpPrefix('claude.ai  repo.name ')).toBe(
      'mcp__claude_ai_repo_name__',
    )
    expect(buildMcpToolName('My Server', 'Open Issue')).toBe(
      'mcp__My_Server__Open_Issue',
    )
  })

  test('uses fully qualified names for MCP permission checks', () => {
    expect(
      getToolNameForPermissionCheck({
        name: 'Write',
      }),
    ).toBe('Write')

    expect(
      getToolNameForPermissionCheck({
        name: 'Write',
        mcpInfo: { serverName: 'GitHub App', toolName: 'Create Comment' },
      }),
    ).toBe('mcp__GitHub_App__Create_Comment')
  })

  test('derives display names for MCP tools', () => {
    expect(
      getMcpDisplayName('mcp__github_enterprise__create_issue', 'github enterprise'),
    ).toBe('create_issue')

    expect(
      extractMcpToolDisplayName('github - Add comment to issue (MCP)'),
    ).toBe('Add comment to issue')
    expect(extractMcpToolDisplayName('Add comment to issue (MCP)')).toBe(
      'Add comment to issue',
    )
    expect(extractMcpToolDisplayName('Add comment to issue')).toBe(
      'Add comment to issue',
    )
  })
})
