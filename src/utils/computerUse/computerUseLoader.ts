import type { ComputerUseAPI } from 'computer-use'

let cached: ComputerUseAPI | undefined

type CjsInterop<T> = T | { default: T }

function unwrapDefault<T>(mod: CjsInterop<T>): T {
  return (mod as { default?: T }).default ?? (mod as T)
}

/**
 * The package is JavaScript-first on macOS. We cache the loaded implementation
 * so callers share the same bridge instance.
 */
export function requireComputerUse(): ComputerUseAPI {
  if (process.platform !== 'darwin') {
    throw new Error('computer-use is macOS-only')
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('computer-use') as CjsInterop<ComputerUseAPI>
  return (cached ??= unwrapDefault(mod))
}

export type { ComputerUseAPI }
