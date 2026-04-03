import { describe, expect, test } from 'bun:test'
import { AGENT_TOOL_NAME } from '../../../src/tools/AgentTool/constants.ts'
import { TASK_OUTPUT_TOOL_NAME } from '../../../src/tools/TaskOutputTool/constants.ts'
import { TASK_STOP_TOOL_NAME } from '../../../src/tools/TaskStopTool/prompt.ts'
import {
  escapeRuleContent,
  getLegacyToolNames,
  normalizeLegacyToolName,
  permissionRuleValueFromString,
  permissionRuleValueToString,
  unescapeRuleContent,
} from '../../../src/utils/permissions/permissionRuleParser.ts'

describe('permissionRuleParser', () => {
  test('normalizes legacy tool names to their canonical form', () => {
    expect(normalizeLegacyToolName('Task')).toBe(AGENT_TOOL_NAME)
    expect(normalizeLegacyToolName('KillShell')).toBe(TASK_STOP_TOOL_NAME)
    expect(normalizeLegacyToolName('AgentOutputTool')).toBe(
      TASK_OUTPUT_TOOL_NAME,
    )
    expect(getLegacyToolNames(AGENT_TOOL_NAME)).toContain('Task')
  })

  test('escapes and unescapes special rule content', () => {
    const content = 'python -c "print(test\\nvalue)"'
    const escaped = escapeRuleContent(content)

    expect(escaped).toBe('python -c "print\\(test\\\\nvalue\\)"')
    expect(unescapeRuleContent(escaped)).toBe(content)
  })

  test('parses plain tool names and canonicalizes legacy names', () => {
    expect(permissionRuleValueFromString('Bash')).toEqual({ toolName: 'Bash' })
    expect(permissionRuleValueFromString('Task')).toEqual({
      toolName: AGENT_TOOL_NAME,
    })
  })

  test('parses rule content with escaped parentheses', () => {
    expect(
      permissionRuleValueFromString('Bash(python -c "print\\(1\\)")'),
    ).toEqual({
      toolName: 'Bash',
      ruleContent: 'python -c "print(1)"',
    })
  })

  test('treats empty and wildcard content as tool-wide rules', () => {
    expect(permissionRuleValueFromString('Bash()')).toEqual({
      toolName: 'Bash',
    })
    expect(permissionRuleValueFromString('Bash(*)')).toEqual({
      toolName: 'Bash',
    })
  })

  test('leaves malformed inputs as literal tool names', () => {
    expect(permissionRuleValueFromString('(foo)')).toEqual({
      toolName: '(foo)',
    })
    expect(permissionRuleValueFromString('Bash(echo hi) trailing')).toEqual({
      toolName: 'Bash(echo hi) trailing',
    })
  })

  test('serializes rule values with escaped content', () => {
    expect(
      permissionRuleValueToString({
        toolName: 'Bash',
        ruleContent: 'python -c "print(1)"',
      }),
    ).toBe('Bash(python -c "print\\(1\\)")')
    expect(permissionRuleValueToString({ toolName: 'Read' })).toBe('Read')
  })
})
