import { describe, expect, test } from 'bun:test'
import { getValidationTip } from '../../../src/utils/settings/validationTips.ts'

describe('validationTips', () => {
  test('returns targeted tips for common settings mistakes', () => {
    expect(
      getValidationTip({
        path: 'permissions.defaultMode',
        code: 'invalid_value',
      }),
    ).toEqual({
      suggestion:
        'Valid modes: "acceptEdits" (ask before file changes), "plan" (analysis only), "bypassPermissions" (auto-accept all), or "default" (standard behavior)',
      docLink: 'https://code.claude.com/docs/en/iam#permission-modes',
    })

    expect(
      getValidationTip({
        path: 'env.PORT',
        code: 'invalid_type',
      }),
    ).toEqual({
      suggestion:
        'Environment variables must be strings. Wrap numbers and booleans in quotes. Example: "DEBUG": "true", "PORT": "3000"',
      docLink: 'https://code.claude.com/docs/en/settings#environment-variables',
    })
  })

  test('adds generic docs links and enum value suggestions when needed', () => {
    expect(
      getValidationTip({
        path: 'permissions.unknownField',
        code: 'unrecognized_keys',
      }),
    ).toEqual({
      suggestion: 'Check for typos or refer to the documentation for valid fields',
      docLink: 'https://code.claude.com/docs/en/settings',
    })

    expect(
      getValidationTip({
        path: 'theme',
        code: 'invalid_value',
        enumValues: ['light', 'dark'],
      }),
    ).toEqual({
      suggestion: 'Valid values: "light", "dark"',
    })

    expect(
      getValidationTip({
        path: 'hooks.PreToolUse',
        code: 'invalid_type',
      }),
    ).toEqual({
      suggestion:
        'Hooks use a matcher + hooks array. The matcher is a string: a tool name ("Bash"), pipe-separated list ("Edit|Write"), or empty to match all. Example: {"PostToolUse": [{"matcher": "Edit|Write", "hooks": [{"type": "command", "command": "echo Done"}]}]}',
      docLink: 'https://code.claude.com/docs/en/hooks',
    })
  })

  test('returns root JSON guidance and null when no matcher applies', () => {
    expect(
      getValidationTip({
        path: '',
        code: 'invalid_type',
        expected: 'object',
        received: null,
      }),
    ).toEqual({
      suggestion:
        'Check for missing commas, unmatched brackets, or trailing commas. Use a JSON validator to identify the exact syntax error.',
    })

    expect(
      getValidationTip({
        path: 'model',
        code: 'custom_error',
      }),
    ).toBeNull()
  })
})
