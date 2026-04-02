import { logForDebugging } from '../debug.js'
import { withResolvers } from '../withResolvers.js'
import { requireComputerUse } from './computerUseLoader.js'

/**
 * Shared compatibility pump for computer-use backends that need main-run-loop
 * servicing. The current CLI JS backend exposes `_drainMainRunLoop()` as a
 * no-op, but keeping the wrapper preserves the desktop contract and avoids
 * special-casing older or future backends.
 *
 * One refcounted setInterval calls `_drainMainRunLoop` every 1ms while any
 * pump-dependent call is pending. Multiple concurrent drainRunLoop() calls
 * share the single pump via retain/release.
 */

let pump: ReturnType<typeof setInterval> | undefined
let pending = 0

function drainTick(cu: ReturnType<typeof requireComputerUse>): void {
  cu._drainMainRunLoop()
}

function retain(): void {
  pending++
  if (pump === undefined) {
    pump = setInterval(drainTick, 1, requireComputerUse())
    logForDebugging('[drainRunLoop] pump started', { level: 'verbose' })
  }
}

function release(): void {
  pending--
  if (pending <= 0 && pump !== undefined) {
    clearInterval(pump)
    pump = undefined
    logForDebugging('[drainRunLoop] pump stopped', { level: 'verbose' })
    pending = 0
  }
}

const TIMEOUT_MS = 30_000

function timeoutReject(reject: (e: Error) => void): void {
  reject(new Error(`computer-use backend call exceeded ${TIMEOUT_MS}ms`))
}

/**
 * Hold a pump reference for the lifetime of a long-lived registration
 * (e.g. the CGEventTap Escape handler). Unlike `drainRunLoop(fn)` this has
 * no timeout — the caller is responsible for calling `releasePump()`. Same
 * refcount as drainRunLoop calls, so nesting is safe.
 */
export const retainPump = retain
export const releasePump = release

/**
 * Await `fn()` with the shared drain pump running. Safe to nest — multiple
 * concurrent drainRunLoop() calls share one setInterval.
 */
export async function drainRunLoop<T>(fn: () => Promise<T>): Promise<T> {
  retain()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    // If the timeout wins the race, fn()'s promise is orphaned — a late
    // rejection from the backend layer would become an unhandledRejection.
    // Attaching a no-op catch swallows it; the timeout error is what surfaces.
    // fn() sits inside try so a synchronous throw still reaches release() —
    // otherwise the pump leaks.
    const work = Promise.resolve().then(fn)
    work.catch(() => {})
    const timeout = withResolvers<never>()
    timer = setTimeout(timeoutReject, TIMEOUT_MS, timeout.reject)
    return await Promise.race([work, timeout.promise])
  } finally {
    clearTimeout(timer)
    release()
  }
}
