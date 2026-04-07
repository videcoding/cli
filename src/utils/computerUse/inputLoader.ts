import type {
  ComputerUseInput,
  ComputerUseInputAPI,
} from 'computer-use-input'

let cached: ComputerUseInputAPI | undefined

/**
 * Load the `computer-use-input` module and narrow its discriminated union on
 * `isSupported` so callers get the bare `ComputerUseInputAPI` without
 * re-checking.
 *
 * key()/keys() dispatch enigo work onto DispatchQueue.main via
 * dispatch2::run_on_main, then block a tokio worker on a channel. Under
 * Electron (CFRunLoop drains the main queue) this works; under libuv
 * (Node/bun) the main queue never drains and the promise hangs. The executor
 * calls these inside drainRunLoop().
 */
export function requireComputerUseInput(): ComputerUseInputAPI {
  if (cached) return cached
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const input = (require('computer-use-input') as {
    default: ComputerUseInput
  }).default
  if (!input.isSupported) {
    throw new Error('computer-use-input is not supported on this platform')
  }
  return (cached = input)
}
