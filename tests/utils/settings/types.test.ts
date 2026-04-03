import { describe, expect, test } from 'bun:test'
import {
  AllowedMcpServerEntrySchema,
  DeniedMcpServerEntrySchema,
  EnvironmentVariablesSchema,
  PermissionsSchema,
} from '../../../src/utils/settings/types.ts'

describe('settings types', () => {
  test('coerces environment variable values to strings', () => {
    expect(
      EnvironmentVariablesSchema().parse({
        PORT: 3000,
        DEBUG: true,
      }),
    ).toEqual({
      PORT: '3000',
      DEBUG: 'true',
    })
  })

  test('accepts valid permissions payloads', () => {
    const result = PermissionsSchema().safeParse({
      allow: ['Bash(git:*)'],
      ask: ['Read(src/**)'],
      defaultMode: 'default',
      additionalDirectories: ['/tmp/workspace'],
      disableBypassPermissionsMode: 'disable',
    })

    expect(result.success).toBe(true)
  })

  test('requires exactly one selector for allowed MCP server entries', () => {
    expect(
      AllowedMcpServerEntrySchema().safeParse({
        serverName: 'github_enterprise',
      }).success,
    ).toBe(true)
    expect(
      AllowedMcpServerEntrySchema().safeParse({
        serverCommand: ['npx', '@modelcontextprotocol/server-github'],
      }).success,
    ).toBe(true)
    expect(
      AllowedMcpServerEntrySchema().safeParse({
        serverUrl: 'https://*.example.com/*',
      }).success,
    ).toBe(true)

    const missingSelector = AllowedMcpServerEntrySchema().safeParse({})
    expect(missingSelector.success).toBe(false)
    if (missingSelector.success) {
      throw new Error('expected validation to fail')
    }
    expect(missingSelector.error.issues[0]?.message).toContain(
      'exactly one of "serverName", "serverCommand", or "serverUrl"',
    )

    const tooManySelectors = AllowedMcpServerEntrySchema().safeParse({
      serverName: 'github',
      serverUrl: 'https://example.com/*',
    })
    expect(tooManySelectors.success).toBe(false)
  })

  test('validates denied MCP entries and command cardinality', () => {
    expect(
      DeniedMcpServerEntrySchema().safeParse({
        serverUrl: 'https://blocked.example.com/*',
      }).success,
    ).toBe(true)

    const invalidName = DeniedMcpServerEntrySchema().safeParse({
      serverName: 'bad name',
    })
    expect(invalidName.success).toBe(false)
    if (invalidName.success) {
      throw new Error('expected validation to fail')
    }
    expect(invalidName.error.issues[0]?.message).toContain(
      'letters, numbers, hyphens, and underscores',
    )

    const emptyCommand = DeniedMcpServerEntrySchema().safeParse({
      serverCommand: [],
    })
    expect(emptyCommand.success).toBe(false)
    if (emptyCommand.success) {
      throw new Error('expected validation to fail')
    }
    expect(emptyCommand.error.issues[0]?.message).toContain(
      'at least one element',
    )
  })
})
