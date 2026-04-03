import { describe, expect, test } from 'bun:test'
import {
  hasWildcards,
  matchWildcardPattern,
  parsePermissionRule,
  permissionRuleExtractPrefix,
  suggestionForExactCommand,
  suggestionForPrefix,
} from '../../../src/utils/permissions/shellRuleMatching.ts'

describe('shellRuleMatching', () => {
  test('extracts legacy prefixes and distinguishes them from wildcard rules', () => {
    expect(permissionRuleExtractPrefix('npm:*')).toBe('npm')
    expect(permissionRuleExtractPrefix('npm *')).toBeNull()
    expect(hasWildcards('npm:*')).toBe(false)
    expect(hasWildcards('npm *')).toBe(true)
    expect(hasWildcards('foo\\*bar')).toBe(false)
  })

  test('matches wildcard patterns including escaped literals', () => {
    expect(matchWildcardPattern('git *', 'git')).toBe(true)
    expect(matchWildcardPattern('git *', 'git status')).toBe(true)
    expect(matchWildcardPattern('file\\*name', 'file*name')).toBe(true)
    expect(matchWildcardPattern('foo\\\\bar', 'foo\\bar')).toBe(true)
    expect(matchWildcardPattern('* run *', 'npm run')).toBe(false)
    expect(matchWildcardPattern('echo *', 'echo one\ntwo')).toBe(true)
    expect(matchWildcardPattern('NPM *', 'npm test', true)).toBe(true)
  })

  test('parses exact, prefix, and wildcard permission rules', () => {
    expect(parsePermissionRule('npm:*')).toEqual({
      type: 'prefix',
      prefix: 'npm',
    })
    expect(parsePermissionRule('npm *')).toEqual({
      type: 'wildcard',
      pattern: 'npm *',
    })
    expect(parsePermissionRule('git status')).toEqual({
      type: 'exact',
      command: 'git status',
    })
  })

  test('builds exact and prefix permission suggestions', () => {
    expect(suggestionForExactCommand('Bash', 'git status')).toEqual([
      {
        type: 'addRules',
        rules: [{ toolName: 'Bash', ruleContent: 'git status' }],
        behavior: 'allow',
        destination: 'localSettings',
      },
    ])
    expect(suggestionForPrefix('Bash', 'npm')).toEqual([
      {
        type: 'addRules',
        rules: [{ toolName: 'Bash', ruleContent: 'npm:*' }],
        behavior: 'allow',
        destination: 'localSettings',
      },
    ])
  })
})
