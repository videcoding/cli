import { describe, expect, test } from 'bun:test'
import { parseSlashCommand } from '../../src/utils/slashCommandParsing.ts'

describe('parseSlashCommand', () => {
  test('parses regular slash commands and preserves argument spacing after the command', () => {
    expect(parseSlashCommand('/search foo bar')).toEqual({
      commandName: 'search',
      args: 'foo bar',
      isMcp: false,
    })
    expect(parseSlashCommand('   /review   file.ts  ')).toEqual({
      commandName: 'review',
      args: '  file.ts',
      isMcp: false,
    })
  })

  test('parses MCP slash commands with the explicit marker', () => {
    expect(parseSlashCommand('/mcp:tool (MCP) arg1 arg2')).toEqual({
      commandName: 'mcp:tool (MCP)',
      args: 'arg1 arg2',
      isMcp: true,
    })
  })

  test('rejects invalid slash command inputs', () => {
    expect(parseSlashCommand('search foo')).toBeNull()
    expect(parseSlashCommand('/')).toBeNull()
    expect(parseSlashCommand('   /   ')).toBeNull()
  })
})
