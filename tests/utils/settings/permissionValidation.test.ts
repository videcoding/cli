import { describe, expect, test } from 'bun:test'
import {
  PermissionRuleSchema,
  validatePermissionRule,
} from '../../../src/utils/settings/permissionValidation.ts'

describe('permissionValidation', () => {
  test('rejects empty rules, mismatched parentheses, and empty parens', () => {
    expect(validatePermissionRule('')).toEqual({
      valid: false,
      error: 'Permission rule cannot be empty',
    })

    expect(validatePermissionRule('Bash(git')).toEqual({
      valid: false,
      error: 'Mismatched parentheses',
      suggestion:
        'Ensure all opening parentheses have matching closing parentheses',
    })

    expect(validatePermissionRule('()')).toEqual({
      valid: false,
      error: 'Empty parentheses with no tool name',
      suggestion: 'Specify a tool name before the parentheses',
    })

    expect(validatePermissionRule('Bash()')).toEqual({
      valid: false,
      error: 'Empty parentheses',
      suggestion:
        'Either specify a pattern or use just "Bash" without parentheses',
      examples: ['Bash', 'Bash(some-pattern)'],
    })
  })

  test('validates MCP permissions without allowing parenthesized patterns', () => {
    expect(validatePermissionRule('mcp__github')).toEqual({ valid: true })
    expect(validatePermissionRule('mcp__github__*')).toEqual({ valid: true })
    expect(validatePermissionRule('mcp__github__list_issues')).toEqual({
      valid: true,
    })

    expect(validatePermissionRule('mcp__github__list_issues(*)')).toEqual({
      valid: false,
      error: 'MCP rules do not support patterns in parentheses',
      suggestion:
        'Use "mcp__github__list_issues" without parentheses, or use "mcp__github__*" for all tools',
      examples: [
        'mcp__github',
        'mcp__github__*',
        'mcp__github__list_issues',
      ],
    })
  })

  test('enforces tool casing and custom WebSearch/WebFetch validation rules', () => {
    expect(validatePermissionRule('bash(ls)')).toEqual({
      valid: false,
      error: 'Tool names must start with uppercase',
      suggestion: 'Use "Bash"',
    })

    expect(validatePermissionRule('WebSearch(claude*)')).toEqual({
      valid: false,
      error: 'WebSearch does not support wildcards',
      suggestion: 'Use exact search terms without * or ?',
      examples: ['WebSearch(claude ai)', 'WebSearch(typescript tutorial)'],
    })

    expect(validatePermissionRule('WebFetch(https://example.com/path)')).toEqual(
      {
        valid: false,
        error: 'WebFetch permissions use domain format, not URLs',
        suggestion: 'Use "domain:hostname" format',
        examples: [
          'WebFetch(domain:example.com)',
          'WebFetch(domain:github.com)',
        ],
      },
    )

    expect(validatePermissionRule('WebFetch(example.com)')).toEqual({
      valid: false,
      error: 'WebFetch permissions must use "domain:" prefix',
      suggestion: 'Use "domain:hostname" format',
      examples: [
        'WebFetch(domain:example.com)',
        'WebFetch(domain:*.google.com)',
      ],
    })

    expect(validatePermissionRule('WebFetch(domain:*.example.com)')).toEqual({
      valid: true,
    })
  })

  test('rejects common Bash and file-pattern rule mistakes', () => {
    expect(validatePermissionRule('Bash(npm:* install)')).toEqual({
      valid: false,
      error: 'The :* pattern must be at the end',
      suggestion:
        'Move :* to the end for prefix matching, or use * for wildcard matching',
      examples: [
        'Bash(npm run:*) - prefix matching (legacy)',
        'Bash(npm run *) - wildcard matching',
      ],
    })

    expect(validatePermissionRule('Bash(:*)')).toEqual({
      valid: false,
      error: 'Prefix cannot be empty before :*',
      suggestion: 'Specify a command prefix before :*',
      examples: ['Bash(npm:*)', 'Bash(git:*)'],
    })

    expect(validatePermissionRule('Edit(src:*)')).toEqual({
      valid: false,
      error: 'The ":*" syntax is only for Bash prefix rules',
      suggestion: 'Use glob patterns like "*" or "**" for file matching',
      examples: [
        'Edit(*.ts) - matches .ts files',
        'Edit(src/**) - matches all files in src',
        'Edit(**/*.test.ts) - matches test files',
      ],
    })

    expect(validatePermissionRule('Read(src*file)')).toEqual({
      valid: false,
      error: 'Wildcard placement might be incorrect',
      suggestion: 'Wildcards are typically used at path boundaries',
      examples: [
        'Read(*.js) - all .js files',
        'Read(src/*) - all files directly in src',
        'Read(src/**) - all files recursively in src',
      ],
    })

    expect(validatePermissionRule('Read(src/**)')).toEqual({ valid: true })
  })

  test('surfaces combined schema messages for invalid permission rules', () => {
    const result = PermissionRuleSchema().safeParse('WebFetch(example.com)')

    expect(result.success).toBe(false)
    if (result.success) {
      throw new Error('expected validation to fail')
    }

    expect(result.error.issues).toHaveLength(1)
    expect(result.error.issues[0]?.message).toContain(
      'WebFetch permissions must use "domain:" prefix',
    )
    expect(result.error.issues[0]?.message).toContain(
      'Use "domain:hostname" format',
    )
    expect(result.error.issues[0]?.message).toContain(
      'Examples: WebFetch(domain:example.com), WebFetch(domain:*.google.com)',
    )
  })
})
