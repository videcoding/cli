import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test'

const pluginsModuleUrl = new URL(
  '../../src/cli/handlers/plugins.ts',
  import.meta.url,
).href
const installedPluginsModuleUrl = new URL(
  '../../src/utils/plugins/installedPluginsManager.js',
  import.meta.url,
).href
const pluginLoaderModuleUrl = new URL(
  '../../src/utils/plugins/pluginLoader.js',
  import.meta.url,
).href
const pluginStartupCheckModuleUrl = new URL(
  '../../src/utils/plugins/pluginStartupCheck.js',
  import.meta.url,
).href

const originalExit = process.exit

let importCounter = 0

async function importFreshPluginsModule() {
  mock.module(installedPluginsModuleUrl, () => ({
    isPluginInstalled: () => false,
    loadInstalledPluginsV2: () => ({ plugins: {} }),
  }))
  mock.module(pluginLoaderModuleUrl, () => ({
    loadAllPlugins: async () => ({
      enabled: [],
      disabled: [],
      errors: [],
    }),
  }))
  mock.module(pluginStartupCheckModuleUrl, () => ({
    getPluginEditableScopes: () => new Set<string>(),
  }))

  importCounter += 1
  return import(`${pluginsModuleUrl}?case=${importCounter}`) as Promise<
    typeof import('../../src/cli/handlers/plugins.ts')
  >
}

afterEach(() => {
  process.exit = originalExit
  mock.restore()
})

describe('plugin handler source tests', () => {
  test('prints the empty-state message from source handlers without spawning the CLI', async () => {
    const stdoutSpy = spyOn(process.stdout, 'write').mockImplementation(
      () => true,
    )
    const exitSpy = mock(() => undefined as never)
    process.exit = exitSpy as typeof process.exit

    const { pluginListHandler } = await importFreshPluginsModule()
    await pluginListHandler({})

    expect(stdoutSpy).toHaveBeenCalledWith(
      'No plugins installed. Use `claude plugin install` to install a plugin.\n',
    )
    expect(exitSpy).toHaveBeenCalledWith(0)

    stdoutSpy.mockRestore()
  })
})
