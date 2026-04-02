import { logForDebugging } from '../debug.js'
import { releasePump, retainPump } from './drainRunLoop.js'
import { requireComputerUse } from './computerUseLoader.js'

/**
 * Global Escape → abort hook surface. Mirrors Cowork's `escAbort.ts`
 * contract but without Electron: the system-level Escape interception, when
 * provided by the active backend, lives behind `computer-use`.
 *
 * Lifecycle: register on fresh lock acquire (`wrapper.tsx` `acquireCuLock`),
 * unregister on lock release (`cleanup.ts`). The tap's CFRunLoopSource sits
 * in .defaultMode on CFRunLoopGetMain(), so we hold a drainRunLoop pump
  * retain for the registration's lifetime — same refcounted setInterval as
 * the other pump-backed computer-use operations.
 *
 * `notifyExpectedEscape()` punches a hole for model-synthesized Escapes: the
 * executor's `key("escape")` calls it before posting the CGEvent. Backend
 * implementations can use that signal to avoid swallowing the next user ESC.
 */

let registered = false

export function registerEscHotkey(onEscape: () => void): boolean {
  if (registered) return true
  const cu = requireComputerUse()
  if (!cu.hotkey.registerEscape(onEscape)) {
    // CGEvent.tapCreate failed — typically missing Accessibility permission.
    // CU still works, just without ESC abort. Mirrors Cowork's escAbort.ts:81.
    logForDebugging('[cu-esc] registerEscape returned false', { level: 'warn' })
    return false
  }
  retainPump()
  registered = true
  logForDebugging('[cu-esc] registered')
  return true
}

export function unregisterEscHotkey(): void {
  if (!registered) return
  try {
    requireComputerUse().hotkey.unregister()
  } finally {
    releasePump()
    registered = false
    logForDebugging('[cu-esc] unregistered')
  }
}

export function notifyExpectedEscape(): void {
  if (!registered) return
  requireComputerUse().hotkey.notifyExpectedEscape()
}
