import { afterEach, describe, expect, mock, test } from 'bun:test'

const permissionRequestModuleUrl = new URL(
  '../../../src/components/permissions/PermissionRequest.tsx',
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
const enterPlanModePermissionRequestModuleUrl = new URL(
  '../../../src/components/permissions/EnterPlanModePermissionRequest/EnterPlanModePermissionRequest.tsx',
  import.meta.url,
).href
const fallbackPermissionRequestModuleUrl = new URL(
  '../../../src/components/permissions/FallbackPermissionRequest.tsx',
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
const enterPlanModeToolModuleUrl = new URL(
  '../../../src/tools/EnterPlanModeTool/EnterPlanModeTool.ts',
  import.meta.url,
).href

let importCounter = 0
const sentinel = Symbol.for('react.memo_cache_sentinel')

type LoadedPermissionRequestModules = {
  PermissionRequest: (props: Record<string, unknown>) => unknown
  FileEditPermissionRequest: unknown
  FilesystemPermissionRequest: unknown
  EnterPlanModePermissionRequest: unknown
  FallbackPermissionRequest: unknown
  FileEditTool: unknown
  FileReadTool: unknown
  EnterPlanModeTool: unknown
}

function createToolUseConfirm(tool: unknown, input: Record<string, unknown> = {}) {
  return {
    assistantMessage: {} as never,
    tool,
    description: '',
    input,
    toolUseContext: {} as never,
    toolUseID: 'tool-use-id',
    permissionResult: 'ask' as never,
    permissionPromptStartTimeMs: 0,
    onUserInteraction() {},
    onAbort() {},
    onAllow() {},
    onReject() {},
    recheckPermission: async () => {},
  }
}

async function loadPermissionRequestModules(options?: {
  onNotify?: (message: string, notificationType: string) => void
  onInterruptBinding?: (action: string, handler: () => void) => void
}): Promise<LoadedPermissionRequestModules> {
  mock.module('react/compiler-runtime', () => ({
    c: (size: number) => Array(size).fill(sentinel),
  }))
  mock.module('../../../src/hooks/useNotifyAfterTimeout.ts', () => ({
    DEFAULT_INTERACTION_THRESHOLD_MS: 6000,
    useNotifyAfterTimeout: (message: string, notificationType: string) => {
      options?.onNotify?.(message, notificationType)
    },
  }))
  mock.module('../../../src/keybindings/useKeybinding.ts', () => ({
    useKeybinding: (action: string, handler: () => void) => {
      options?.onInterruptBinding?.(action, handler)
    },
    useKeybindings: () => {},
  }))

  importCounter += 1
  const permissionRequestModule = await import(
    `${permissionRequestModuleUrl}?case=${importCounter}`
  )
  const [
    fileEditPermissionRequestModule,
    filesystemPermissionRequestModule,
    enterPlanModePermissionRequestModule,
    fallbackPermissionRequestModule,
    fileEditToolModule,
    fileReadToolModule,
    enterPlanModeToolModule,
  ] = await Promise.all([
    import(fileEditPermissionRequestModuleUrl),
    import(filesystemPermissionRequestModuleUrl),
    import(enterPlanModePermissionRequestModuleUrl),
    import(fallbackPermissionRequestModuleUrl),
    import(fileEditToolModuleUrl),
    import(fileReadToolModuleUrl),
    import(enterPlanModeToolModuleUrl),
  ])

  return {
    ...permissionRequestModule,
    ...fileEditPermissionRequestModule,
    ...filesystemPermissionRequestModule,
    ...enterPlanModePermissionRequestModule,
    ...fallbackPermissionRequestModule,
    ...fileEditToolModule,
    ...fileReadToolModule,
    ...enterPlanModeToolModule,
  } as LoadedPermissionRequestModules
}

afterEach(() => {
  mock.restore()
})

describe('PermissionRequest', () => {
  test('renders the expected permission request component for public tool entrypoints', async () => {
    const {
      PermissionRequest,
      FileEditPermissionRequest,
      FilesystemPermissionRequest,
      EnterPlanModePermissionRequest,
      FallbackPermissionRequest,
      FileEditTool,
      FileReadTool,
      EnterPlanModeTool,
    } = await loadPermissionRequestModules()

    const fileEditElement = PermissionRequest({
      toolUseConfirm: createToolUseConfirm(FileEditTool),
      toolUseContext: {} as never,
      onDone() {},
      onReject() {},
      verbose: false,
      workerBadge: undefined,
    }) as { type: unknown }

    const fileReadElement = PermissionRequest({
      toolUseConfirm: createToolUseConfirm(FileReadTool),
      toolUseContext: {} as never,
      onDone() {},
      onReject() {},
      verbose: false,
      workerBadge: undefined,
    }) as { type: unknown }

    const enterPlanElement = PermissionRequest({
      toolUseConfirm: createToolUseConfirm(EnterPlanModeTool),
      toolUseContext: {} as never,
      onDone() {},
      onReject() {},
      verbose: false,
      workerBadge: undefined,
    }) as { type: unknown }

    const fallbackElement = PermissionRequest({
      toolUseConfirm: createToolUseConfirm({
        userFacingName: () => 'Unknown tool',
      }),
      toolUseContext: {} as never,
      onDone() {},
      onReject() {},
      verbose: false,
      workerBadge: undefined,
    }) as { type: unknown }

    expect(fileEditElement.type).toBe(FileEditPermissionRequest)
    expect(fileReadElement.type).toBe(FilesystemPermissionRequest)
    expect(enterPlanElement.type).toBe(EnterPlanModePermissionRequest)
    expect(fallbackElement.type).toBe(FallbackPermissionRequest)
  })

  test('uses the public component to produce the expected notification messages and interrupt behavior', async () => {
    const notifications: Array<{ message: string; notificationType: string }> = []
    let interruptAction = ''
    let interruptHandler: (() => void) | undefined
    const onDone = mock(() => {})
    const onReject = mock(() => {})
    const toolReject = mock(() => {})

    const { PermissionRequest, EnterPlanModeTool } =
      await loadPermissionRequestModules({
        onNotify: (message, notificationType) => {
          notifications.push({ message, notificationType })
        },
        onInterruptBinding: (action, handler) => {
          interruptAction = action
          interruptHandler = handler
        },
      })

    PermissionRequest({
      toolUseConfirm: {
        ...createToolUseConfirm(EnterPlanModeTool),
        onReject: toolReject,
      },
      toolUseContext: {} as never,
      onDone,
      onReject,
      verbose: false,
      workerBadge: undefined,
    })

    expect(notifications).toEqual([
      {
        message: 'Claude Code wants to enter plan mode',
        notificationType: 'permission_prompt',
      },
    ])
    expect(interruptAction).toBe('app:interrupt')

    interruptHandler?.()

    expect(onDone).toHaveBeenCalledTimes(1)
    expect(onReject).toHaveBeenCalledTimes(1)
    expect(toolReject).toHaveBeenCalledTimes(1)
  })
})
