import { describe, expect, test } from 'bun:test'
import {
  filterInvalidPermissionRules,
  validateSettingsFileContent,
} from '../../../src/utils/settings/validation.ts'

describe('settings validation', () => {
  test('accepts valid settings content', () => {
    expect(
      validateSettingsFileContent(
        JSON.stringify({
          permissions: { defaultMode: 'default' },
          env: { DEBUG: '1' },
        }),
      ),
    ).toEqual({ isValid: true })
  })

  test('returns helpful messages for invalid JSON and malformed top-level shapes', () => {
    const invalidJson = validateSettingsFileContent('{ bad json')
    const malformedRoot = validateSettingsFileContent('null')

    expect(invalidJson.isValid).toBe(false)
    if (invalidJson.isValid) throw new Error('unreachable')
    expect(invalidJson.error).toContain('Invalid JSON:')
    expect(invalidJson.fullSchema).toContain('json-schema.org')

    expect(malformedRoot.isValid).toBe(false)
    if (malformedRoot.isValid) throw new Error('unreachable')
    expect(malformedRoot.error).toContain('Invalid or malformed JSON')
    expect(malformedRoot.fullSchema).toContain('claude-code-settings.json')
  })

  test('formats schema validation errors for invalid enum values and unknown fields', () => {
    const invalidEnum = validateSettingsFileContent(
      JSON.stringify({
        permissions: { defaultMode: 123 },
      }),
    )
    const unknownField = validateSettingsFileContent(
      JSON.stringify({ unknownKey: true }),
    )

    expect(invalidEnum.isValid).toBe(false)
    if (invalidEnum.isValid) throw new Error('unreachable')
    expect(invalidEnum.error).toContain('permissions.defaultMode')
    expect(invalidEnum.error).toContain('Invalid value. Expected one of')

    expect(unknownField.isValid).toBe(false)
    if (unknownField.isValid) throw new Error('unreachable')
    expect(unknownField.error).toContain('Unrecognized field')
  })

  test('filters invalid permission rules instead of poisoning the whole settings object', () => {
    const data = {
      permissions: {
        allow: ['Bash(git:*)', 'Bash()', 123],
        deny: ['bash(ls)'],
      },
    }

    const warnings = filterInvalidPermissionRules(data, 'settings.json')

    expect(warnings).toHaveLength(3)
    expect(warnings[0]?.message).toContain('Invalid permission rule "Bash()"')
    expect(warnings[1]?.message).toContain('Non-string value in allow array')
    expect(warnings[2]?.message).toContain('Tool names must start with uppercase')
    expect(data).toEqual({
      permissions: {
        allow: ['Bash(git:*)'],
        deny: [],
      },
    })
  })
})
