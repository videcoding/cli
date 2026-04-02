import type {
  ComputerUseInput,
  ComputerUseInputAPI,
} from 'computer-use-input'

let cached: ComputerUseInputAPI | undefined

type CjsInterop<T> = T | { default: T }

function unwrapDefault<T>(mod: CjsInterop<T>): T {
  return (mod as { default?: T }).default ?? (mod as T)
}

/**
 * The package exports a discriminated union on `isSupported` — narrowed here
 * once so callers get the bare `ComputerUseInputAPI` without re-checking.
 */
export function requireComputerUseInput(): ComputerUseInputAPI {
  if (cached) return cached
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('computer-use-input') as CjsInterop<ComputerUseInput>
  const input = unwrapDefault(mod)
  if (!input.isSupported) {
    throw new Error('computer-use-input is not supported on this platform')
  }
  return (cached = input)
}
