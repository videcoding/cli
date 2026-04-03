import { describe, expect, test } from 'bun:test'

const permissionRequestModuleUrl = new URL(
  '../../../src/components/permissions/PermissionRequest.tsx',
  import.meta.url,
).href
const bashPermissionRequestModuleUrl = new URL(
  '../../../src/components/permissions/BashPermissionRequest/BashPermissionRequest.tsx',
  import.meta.url,
).href
const fallbackPermissionRequestModuleUrl = new URL(
  '../../../src/components/permissions/FallbackPermissionRequest.tsx',
  import.meta.url,
).href
const fileEditPermissionRequestModuleUrl = new URL(
  '../../../src/components/permissions/FileEditPermissionRequest/FileEditPermissionRequest.tsx',
  import.meta.url,
).href
const filesystemPermissionRequestModuleUrl = new URL(
  '../../../src/components/permissions/FilesystemPermissionRequest/FilesystemPermissionRequest.tsx',
  import.meta.url,
).href
const fileWritePermissionRequestModuleUrl = new URL(
  '../../../src/components/permissions/FileWritePermissionRequest/FileWritePermissionRequest.tsx',
  import.meta.url,
).href
const enterPlanModeToolModuleUrl = new URL(
  '../../../src/tools/EnterPlanModeTool/EnterPlanModeTool.ts',
  import.meta.url,
).href
const exitPlanModeToolModuleUrl = new URL(
  '../../../src/tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts',
  import.meta.url,
).href
const bashToolModuleUrl = new URL(
  '../../../src/tools/BashTool/BashTool.tsx',
  import.meta.url,
).href
const fileEditToolModuleUrl = new URL(
  '../../../src/tools/FileEditTool/FileEditTool.ts',
  import.meta.url,
).href
const fileReadToolModuleUrl = new URL(
  '../../../src/tools/FileReadTool/FileReadTool.ts',
  import.meta.url,
).href
const fileWriteToolModuleUrl = new URL(
  '../../../src/tools/FileWriteTool/FileWriteTool.ts',
  import.meta.url,
).href
const globToolModuleUrl = new URL(
  '../../../src/tools/GlobTool/GlobTool.ts',
  import.meta.url,
).href
const grepToolModuleUrl = new URL(
  '../../../src/tools/GrepTool/GrepTool.ts',
  import.meta.url,
).href

let importCounter = 0

function makeToolUseConfirm(tool: unknown, input: unknown = {}) {
  return {
    tool,
    input,
  } as never
}

async function loadPermissionRequestModules() {
  importCounter += 1
  const permissionRequestModule = await import(
    `${permissionRequestModuleUrl}?case=${importCounter}`
  )
  const [
    bashPermissionRequestModule,
    fallbackPermissionRequestModule,
    fileEditPermissionRequestModule,
    filesystemPermissionRequestModule,
    fileWritePermissionRequestModule,
    enterPlanModeToolModule,
    exitPlanModeToolModule,
    bashToolModule,
    fileEditToolModule,
    fileReadToolModule,
    fileWriteToolModule,
    globToolModule,
    grepToolModule,
  ] = await Promise.all([
    import(bashPermissionRequestModuleUrl),
    import(fallbackPermissionRequestModuleUrl),
    import(fileEditPermissionRequestModuleUrl),
    import(filesystemPermissionRequestModuleUrl),
    import(fileWritePermissionRequestModuleUrl),
    import(enterPlanModeToolModuleUrl),
    import(exitPlanModeToolModuleUrl),
    import(bashToolModuleUrl),
    import(fileEditToolModuleUrl),
    import(fileReadToolModuleUrl),
    import(fileWriteToolModuleUrl),
    import(globToolModuleUrl),
    import(grepToolModuleUrl),
  ])

  return {
    ...permissionRequestModule,
    ...bashPermissionRequestModule,
    ...fallbackPermissionRequestModule,
    ...fileEditPermissionRequestModule,
    ...filesystemPermissionRequestModule,
    ...fileWritePermissionRequestModule,
    ...enterPlanModeToolModule,
    ...exitPlanModeToolModule,
    ...bashToolModule,
    ...fileEditToolModule,
    ...fileReadToolModule,
    ...fileWriteToolModule,
    ...globToolModule,
    ...grepToolModule,
  }
}

describe('PermissionRequest helpers', () => {
  test('routes tools to the expected permission request components', async () => {
    const {
      permissionComponentForTool,
      BashPermissionRequest,
      FallbackPermissionRequest,
      FileEditPermissionRequest,
      FilesystemPermissionRequest,
      FileWritePermissionRequest,
      BashTool,
      FileEditTool,
      FileReadTool,
      FileWriteTool,
      GlobTool,
      GrepTool,
    } = await loadPermissionRequestModules()

    expect(permissionComponentForTool(FileEditTool)).toBe(FileEditPermissionRequest)
    expect(permissionComponentForTool(FileWriteTool)).toBe(
      FileWritePermissionRequest,
    )
    expect(permissionComponentForTool(BashTool)).toBe(BashPermissionRequest)
    expect(permissionComponentForTool(FileReadTool)).toBe(
      FilesystemPermissionRequest,
    )
    expect(permissionComponentForTool(GlobTool)).toBe(FilesystemPermissionRequest)
    expect(permissionComponentForTool(GrepTool)).toBe(FilesystemPermissionRequest)
    expect(
      permissionComponentForTool({
        userFacingName: () => 'Unknown tool',
      } as never),
    ).toBe(FallbackPermissionRequest)
  })

  test('builds special-case and fallback notification messages', async () => {
    const {
      EnterPlanModeTool,
      ExitPlanModeV2Tool,
      getNotificationMessage,
    } = await loadPermissionRequestModules()

    expect(getNotificationMessage(makeToolUseConfirm(ExitPlanModeV2Tool))).toBe(
      'Claude Code needs your approval for the plan',
    )
    expect(getNotificationMessage(makeToolUseConfirm(EnterPlanModeTool))).toBe(
      'Claude Code wants to enter plan mode',
    )
    expect(
      getNotificationMessage(
        makeToolUseConfirm({
          userFacingName: () => '   ',
        } as never),
      ),
    ).toBe('Claude Code needs your attention')
    expect(
      getNotificationMessage(
        makeToolUseConfirm({
          userFacingName: () => 'Custom Tool',
        } as never),
      ),
    ).toBe('Claude needs your permission to use Custom Tool')
  })
})
