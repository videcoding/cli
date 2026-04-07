type ComputerUseAPI = typeof import('computer-use').default

let cached: ComputerUseAPI | undefined

/**
 * Cache the loaded `computer-use` package.
 *
 * The four @MainActor methods (captureExcluding, captureRegion,
 * apps.listInstalled, resolvePrepareCapture) dispatch to DispatchQueue.main
 * and will hang under libuv unless CFRunLoop is pumped — call sites wrap
 * these in drainRunLoop().
 */
export function requireComputerUse(): ComputerUseAPI {
  if (process.platform !== 'darwin') {
    throw new Error('computer-use is macOS-only')
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (cached ??=
    (require('computer-use') as { default: ComputerUseAPI }).default)
}

export type { ComputerUseAPI }
