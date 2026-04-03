import { describe, expect, test } from 'bun:test'
import { getEmptyToolPermissionContext } from '../../../src/Tool.ts'
import {
  BINARY_HIJACK_VARS,
  bashToolCheckExactMatchPermission,
  bashToolCheckPermission,
  getFirstWordPrefix,
  getSimpleCommandPrefix,
  stripAllLeadingEnvVars,
  stripSafeWrappers,
  stripWrappersFromArgv,
} from '../../../src/tools/BashTool/bashPermissions.ts'

function createPermissionContext({
  allow = [],
  ask = [],
  deny = [],
}: {
  allow?: string[]
  ask?: string[]
  deny?: string[]
} = {}) {
  return {
    ...getEmptyToolPermissionContext(),
    alwaysAllowRules: allow.length > 0 ? { userSettings: allow } : {},
    alwaysAskRules: ask.length > 0 ? { userSettings: ask } : {},
    alwaysDenyRules: deny.length > 0 ? { userSettings: deny } : {},
  }
}

describe('bashPermissions', () => {
  test('extracts stable prefixes only for safe environment-prefixed commands', () => {
    expect(getSimpleCommandPrefix('NODE_ENV=production npm run build')).toBe(
      'npm run',
    )
    expect(getFirstWordPrefix('NODE_ENV=production pytest tests/unit')).toBe(
      'pytest',
    )

    expect(getSimpleCommandPrefix('UNSAFE_VAR=1 npm run build')).toBeNull()
    expect(getFirstWordPrefix('UNSAFE_VAR=1 pytest tests/unit')).toBeNull()
  })

  test('refuses to suggest bare shell prefixes', () => {
    expect(getSimpleCommandPrefix('bash -lc "echo hi"')).toBeNull()
    expect(getFirstWordPrefix('bash script.sh')).toBeNull()
  })

  test('strips only safe wrappers and leading safe env vars', () => {
    expect(
      stripSafeWrappers(
        '# explain the command\nNODE_ENV=test timeout --signal TERM 5 npm run build',
      ),
    ).toBe('npm run build')

    expect(stripSafeWrappers('timeout 5 FOO=bar npm run build')).toBe(
      'FOO=bar npm run build',
    )

    expect(stripSafeWrappers('nice -n 10 -- git status')).toBe('git status')
  })

  test('strips wrapper argv consistently and fails closed on invalid timeout flags', () => {
    expect(
      stripWrappersFromArgv(['timeout', '--signal', 'TERM', '5', 'npm', 'test']),
    ).toEqual(['npm', 'test'])

    expect(stripWrappersFromArgv(['nohup', '--', 'rm', '--', 'file.txt'])).toEqual([
      'rm',
      '--',
      'file.txt',
    ])

    const invalidTimeoutArgv = ['timeout', '--bogus', '5', 'npm', 'test']
    expect(stripWrappersFromArgv(invalidTimeoutArgv)).toEqual(invalidTimeoutArgv)
  })

  test('strips all leading env vars for deny matching and respects blocklisted hijack vars', () => {
    expect(stripAllLeadingEnvVars(`FOO='bar baz' BAR+=qux cmd --flag`)).toBe(
      'cmd --flag',
    )

    expect(
      stripAllLeadingEnvVars('PATH=/tmp/custom FOO=bar cmd --flag', BINARY_HIJACK_VARS),
    ).toBe('PATH=/tmp/custom FOO=bar cmd --flag')
  })

  test('denies exact-match commands even when prefixed with arbitrary env vars', () => {
    const result = bashToolCheckExactMatchPermission(
      { command: 'FOO=bar claude' } as never,
      createPermissionContext({
        deny: ['Bash(claude)'],
      }),
    )

    expect(result.behavior).toBe('deny')
  })

  test('applies prefix allow and deny rules after stripping wrappers without allowing compound bypasses', () => {
    const allowResult = bashToolCheckPermission(
      { command: 'timeout --signal TERM 5 npm run build' } as never,
      createPermissionContext({
        allow: ['Bash(npm run:*)'],
      }),
    )
    expect(allowResult.behavior).toBe('allow')

    const denyResult = bashToolCheckPermission(
      { command: 'nohup FOO=bar timeout 5 rm -rf /tmp/demo' } as never,
      createPermissionContext({
        deny: ['Bash(rm:*)'],
      }),
    )
    expect(denyResult.behavior).toBe('deny')

    const compoundResult = bashToolCheckPermission(
      { command: 'cd /tmp && echo hi' } as never,
      createPermissionContext({
        allow: ['Bash(cd:*)'],
      }),
    )
    expect(compoundResult.behavior).not.toBe('allow')
  })
})
