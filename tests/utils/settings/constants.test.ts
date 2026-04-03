import { afterEach, describe, expect, test } from 'bun:test'
import {
  getAllowedSettingSources,
  setAllowedSettingSources,
} from '../../../src/bootstrap/state.ts'
import {
  CLAUDE_CODE_SETTINGS_SCHEMA_URL,
  SOURCES,
  getEnabledSettingSources,
  getSettingSourceDisplayNameCapitalized,
  getSettingSourceDisplayNameLowercase,
  getSettingSourceName,
  getSourceDisplayName,
  isSettingSourceEnabled,
  parseSettingSourcesFlag,
} from '../../../src/utils/settings/constants.ts'

const originalAllowedSources = getAllowedSettingSources()

afterEach(() => {
  setAllowedSettingSources([...originalAllowedSources])
})

describe('settings constants', () => {
  test('maps setting sources to display names', () => {
    expect(getSettingSourceName('localSettings')).toBe('project, gitignored')
    expect(getSourceDisplayName('built-in')).toBe('Built-in')
    expect(getSettingSourceDisplayNameLowercase('policySettings')).toBe(
      'enterprise managed settings',
    )
    expect(getSettingSourceDisplayNameCapitalized('session')).toBe(
      'Current session',
    )
  })

  test('parses the --setting-sources flag and rejects invalid values', () => {
    expect(parseSettingSourcesFlag('user, project,local')).toEqual([
      'userSettings',
      'projectSettings',
      'localSettings',
    ])
    expect(parseSettingSourcesFlag('')).toEqual([])
    expect(() => parseSettingSourcesFlag('user,unknown')).toThrow(
      'Invalid setting source: unknown',
    )
  })

  test('always enables flag and policy settings in addition to allowed sources', () => {
    setAllowedSettingSources(['userSettings'])

    expect(getEnabledSettingSources()).toEqual([
      'userSettings',
      'policySettings',
      'flagSettings',
    ])
    expect(isSettingSourceEnabled('userSettings')).toBe(true)
    expect(isSettingSourceEnabled('policySettings')).toBe(true)
    expect(isSettingSourceEnabled('flagSettings')).toBe(true)
    expect(isSettingSourceEnabled('localSettings')).toBe(false)
  })

  test('exports the editable source order and schema URL', () => {
    expect(SOURCES).toEqual([
      'localSettings',
      'projectSettings',
      'userSettings',
    ])
    expect(CLAUDE_CODE_SETTINGS_SCHEMA_URL).toBe(
      'https://json.schemastore.org/claude-code-settings.json',
    )
  })
})
