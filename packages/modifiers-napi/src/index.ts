import { createRequire } from 'module'

const require = createRequire(import.meta.url)

const FLAG_SHIFT = 0x20000
const FLAG_CONTROL = 0x40000
const FLAG_OPTION = 0x80000
const FLAG_COMMAND = 0x100000

const modifierFlags: Record<string, number> = {
  shift: FLAG_SHIFT,
  control: FLAG_CONTROL,
  option: FLAG_OPTION,
  command: FLAG_COMMAND,
}

const kCGEventSourceStateCombinedSessionState = 0

let cgEventSourceFlagsState: ((stateID: number) => number) | null | undefined

function loadFFI(): ((stateID: number) => number) | null {
  if (cgEventSourceFlagsState !== undefined) {
    return cgEventSourceFlagsState
  }

  if (process.platform !== 'darwin') {
    cgEventSourceFlagsState = null
    return null
  }

  try {
    const ffi = require('bun:ffi') as typeof import('bun:ffi')
    const lib = ffi.dlopen('/System/Library/Frameworks/Carbon.framework/Carbon', {
      CGEventSourceFlagsState: {
        args: [ffi.FFIType.i32],
        returns: ffi.FFIType.u64,
      },
    })
    cgEventSourceFlagsState = (stateID: number): number =>
      Number(lib.symbols.CGEventSourceFlagsState(stateID))
  } catch {
    cgEventSourceFlagsState = null
  }

  return cgEventSourceFlagsState
}

function getCurrentFlags(): number {
  const readFlags = loadFFI()
  if (!readFlags) {
    return 0
  }

  return readFlags(kCGEventSourceStateCombinedSessionState)
}

export function getModifiers(): string[] {
  const currentFlags = getCurrentFlags()
  if (!currentFlags) {
    return []
  }

  return Object.entries(modifierFlags)
    .filter(([, flag]) => (currentFlags & flag) !== 0)
    .map(([modifier]) => modifier)
}

export function isModifierPressed(modifier: string): boolean {
  const flag = modifierFlags[modifier]
  if (flag === undefined) {
    return false
  }

  return (getCurrentFlags() & flag) !== 0
}

export function prewarm(): void {
  loadFFI()
}
