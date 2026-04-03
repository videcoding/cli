import { afterEach, describe, expect, test } from 'bun:test'
import {
  clearPluginSettingsBase,
  getCachedParsedFile,
  getCachedSettingsForSource,
  getPluginSettingsBase,
  getSessionSettingsCache,
  resetSettingsCache,
  setCachedParsedFile,
  setCachedSettingsForSource,
  setPluginSettingsBase,
  setSessionSettingsCache,
} from '../../../src/utils/settings/settingsCache.ts'

afterEach(() => {
  resetSettingsCache()
  clearPluginSettingsBase()
})

describe('settingsCache', () => {
  test('stores and clears the merged session settings cache', () => {
    const settingsWithErrors = {
      settings: { model: 'sonnet' },
      errors: [],
    }

    setSessionSettingsCache(settingsWithErrors as never)
    expect(getSessionSettingsCache()).toEqual(settingsWithErrors)

    resetSettingsCache()
    expect(getSessionSettingsCache()).toBeNull()
  })

  test('stores per-source settings and parsed file cache entries', () => {
    const perSourceValue = { permissions: { allow: ['Read'] } }
    const parsedFileValue = {
      settings: { model: 'opus' },
      errors: [],
    }

    expect(getCachedSettingsForSource('userSettings')).toBeUndefined()
    setCachedSettingsForSource('userSettings', perSourceValue as never)
    expect(getCachedSettingsForSource('userSettings')).toEqual(perSourceValue)

    setCachedParsedFile('/tmp/settings.json', parsedFileValue as never)
    expect(getCachedParsedFile('/tmp/settings.json')).toEqual(parsedFileValue)

    resetSettingsCache()
    expect(getCachedSettingsForSource('userSettings')).toBeUndefined()
    expect(getCachedParsedFile('/tmp/settings.json')).toBeUndefined()
  })

  test('stores and clears plugin base settings', () => {
    const pluginBase = { theme: 'dark' }

    setPluginSettingsBase(pluginBase)
    expect(getPluginSettingsBase()).toEqual(pluginBase)

    clearPluginSettingsBase()
    expect(getPluginSettingsBase()).toBeUndefined()
  })
})
