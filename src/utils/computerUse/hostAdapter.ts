import type {
  ComputerUseHostAdapter,
  CuOsPermissionRequirements,
  Logger,
} from 'computer-use-mcp/types'
import { format } from 'util'
import { logForDebugging } from '../debug.js'
import { COMPUTER_USE_MCP_SERVER_NAME } from './common.js'
import { requireComputerUse } from './computerUseLoader.js'
import { createCliExecutor } from './executor.js'
import { getChicagoEnabled, getChicagoSubGates } from './gates.js'

class DebugLogger implements Logger {
  silly(message: string, ...args: unknown[]): void {
    logForDebugging(format(message, ...args), { level: 'debug' })
  }
  debug(message: string, ...args: unknown[]): void {
    logForDebugging(format(message, ...args), { level: 'debug' })
  }
  info(message: string, ...args: unknown[]): void {
    logForDebugging(format(message, ...args), { level: 'info' })
  }
  warn(message: string, ...args: unknown[]): void {
    logForDebugging(format(message, ...args), { level: 'warn' })
  }
  error(message: string, ...args: unknown[]): void {
    logForDebugging(format(message, ...args), { level: 'error' })
  }
}

let cached: ComputerUseHostAdapter | undefined
type OsPermissionKey = 'accessibility' | 'screenRecording'

const permissionRequestAttempted: Record<OsPermissionKey, boolean> = {
  accessibility: false,
  screenRecording: false,
}
const permissionRequestPromises: Partial<
  Record<OsPermissionKey, Promise<boolean>>
> = {}

const PERMISSION_WAIT_MS = Number.parseInt(
  process.env.CLAUDE_CODE_GUI_PERMISSION_WAIT_MS ?? '120000',
  10,
)
const PERMISSION_POLL_MS = 1000

function readOsPermissionState(cu: {
  tcc: {
    checkAccessibility: () => boolean
    checkScreenRecording: () => boolean
  }
}): { accessibility: boolean; screenRecording: boolean } {
  return {
    accessibility: cu.tcc.checkAccessibility(),
    screenRecording: cu.tcc.checkScreenRecording(),
  }
}

async function waitForPermission(
  check: () => boolean,
  timeoutMs: number,
): Promise<boolean> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (check()) {
      return true
    }
    await new Promise(resolve => setTimeout(resolve, PERMISSION_POLL_MS))
  }
  return check()
}

function normalizeRequiredPermissions(
  required?: CuOsPermissionRequirements,
): Required<CuOsPermissionRequirements> {
  return {
    accessibility: required?.accessibility === true,
    screenRecording: required?.screenRecording === true,
  }
}

async function ensurePermission(
  key: OsPermissionKey,
  check: () => boolean,
  request: (() => boolean) | undefined,
  requestMissing: boolean,
): Promise<boolean> {
  if (check()) {
    return true
  }
  if (!requestMissing) {
    return false
  }
  if (permissionRequestPromises[key]) {
    return permissionRequestPromises[key]
  }
  if (permissionRequestAttempted[key]) {
    return check()
  }

  permissionRequestAttempted[key] = true
  const label =
    key === 'accessibility' ? 'Accessibility' : 'Screen Recording'
  logForDebugging(
    `[computer-use] requesting ${label} permission for current action`,
    { level: 'info' },
  )

  const promise = (async () => {
    try {
      request?.()
    } catch {
      // Fall through to polling the current state.
    }
    return waitForPermission(check, PERMISSION_WAIT_MS)
  })().finally(() => {
    delete permissionRequestPromises[key]
  })
  permissionRequestPromises[key] = promise
  return promise
}

/**
 * Process-lifetime singleton. Built once on first CU tool call; both
 * computer-use backends (`computer-use-input` and `computer-use`) are loaded
 * here via the executor factory, which throws on load failure — there is no
 * degraded mode.
 */
export function getComputerUseHostAdapter(): ComputerUseHostAdapter {
  if (cached) return cached
  cached = {
    serverName: COMPUTER_USE_MCP_SERVER_NAME,
    logger: new DebugLogger(),
    executor: createCliExecutor({
      getMouseAnimationEnabled: () => getChicagoSubGates().mouseAnimation,
      getHideBeforeActionEnabled: () => getChicagoSubGates().hideBeforeAction,
    }),
    ensureOsPermissions: async (required, options) => {
      const cu = requireComputerUse() as ReturnType<
        typeof requireComputerUse
      > & {
        tcc: {
          checkAccessibility: () => boolean
          checkScreenRecording: () => boolean
          requestAccessibility?: () => boolean
          requestScreenRecording?: () => boolean
        }
      }

      const normalized = normalizeRequiredPermissions(required)
      const requestMissing = options?.requestMissing !== false

      let { accessibility, screenRecording } = readOsPermissionState(cu)

      if (normalized.accessibility && !accessibility) {
        accessibility = await ensurePermission(
          'accessibility',
          cu.tcc.checkAccessibility,
          cu.tcc.requestAccessibility,
          requestMissing,
        )
      } else {
        accessibility = cu.tcc.checkAccessibility()
      }

      if (normalized.screenRecording && !screenRecording) {
        screenRecording = await ensurePermission(
          'screenRecording',
          cu.tcc.checkScreenRecording,
          cu.tcc.requestScreenRecording,
          requestMissing,
        )
      } else {
        screenRecording = cu.tcc.checkScreenRecording()
      }

      return {
        granted:
          (!normalized.accessibility || accessibility) &&
          (!normalized.screenRecording || screenRecording),
        accessibility,
        screenRecording,
      }
    },
    isDisabled: () => !getChicagoEnabled(),
    getSubGates: getChicagoSubGates,
    // cleanup.ts always unhides at turn end — no user preference to disable it.
    getAutoUnhideEnabled: () => true,

    // Pixel-validation JPEG decode+crop. MUST be synchronous (the package
    // does `patch1.equals(patch2)` directly on the return value). Cowork uses
    // Electron's `nativeImage` (sync); our `image-processor-napi` is
    // sharp-compatible and async-only. Returning null → validation skipped,
    // click proceeds — the designed fallback per `PixelCompareResult.skipped`.
    // The sub-gate defaults to false anyway.
    cropRawPatch: () => null,
  }
  return cached
}
