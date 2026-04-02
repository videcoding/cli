import { spawnSync } from 'node:child_process'
import { mkdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SOURCE_DIR = dirname(fileURLToPath(import.meta.url))
const JXA_DRIVER_PATH = join(
  SOURCE_DIR,
  'driver-jxa.js',
)
const SWIFT_DRIVER_PATH = join(
  SOURCE_DIR,
  'driver-swift.swift',
)
const BUILD_DIR = join(tmpdir(), 'claude-code-computer-use-input')
const SWIFT_MODULE_CACHE_DIR = join(BUILD_DIR, 'swift-module-cache')
const SWIFT_BINARY_PATH = join(BUILD_DIR, 'driver-swift')

function statMtimeMs(path) {
  try {
    return statSync(path).mtimeMs
  } catch {
    return 0
  }
}

function trimCommandFailure(result, fallbackMessage) {
  return (result.stderr || result.stdout || fallbackMessage).trim()
}

function ensureSwiftDriver() {
  const sourceMtime = statMtimeMs(SWIFT_DRIVER_PATH)
  if (!sourceMtime) {
    return { available: false, reason: 'compiled input driver source is missing' }
  }

  const binaryMtime = statMtimeMs(SWIFT_BINARY_PATH)
  if (binaryMtime >= sourceMtime) {
    return { available: true }
  }

  mkdirSync(SWIFT_MODULE_CACHE_DIR, { recursive: true })
  const result = spawnSync(
    '/usr/bin/swiftc',
    [
      '-module-cache-path',
      SWIFT_MODULE_CACHE_DIR,
      SWIFT_DRIVER_PATH,
      '-o',
      SWIFT_BINARY_PATH,
    ],
    {
      encoding: 'utf8',
      stdio: 'pipe',
    },
  )

  if (result.error) {
    return { available: false, reason: result.error.message }
  }
  if (result.status !== 0) {
    return {
      available: false,
      reason: trimCommandFailure(result, 'swiftc failed'),
    }
  }

  return { available: true }
}

function runSwiftDriver(payload) {
  const result = spawnSync(SWIFT_BINARY_PATH, [JSON.stringify(payload)], {
    encoding: 'utf8',
    stdio: 'pipe',
  })

  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(trimCommandFailure(result, 'compiled input driver failed'))
  }

  const output = (result.stdout ?? '').trim()
  if (!output) {
    return true
  }
  return JSON.parse(output)
}

function runJxaDriver(payload) {
  const result = spawnSync(
    '/usr/bin/osascript',
    ['-l', 'JavaScript', JXA_DRIVER_PATH, JSON.stringify(payload)],
    {
      encoding: 'utf8',
      stdio: 'pipe',
    },
  )

  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(trimCommandFailure(result, 'osascript failed'))
  }

  const output = (result.stdout ?? '').trim()
  if (!output) {
    return true
  }
  return JSON.parse(output)
}

function typeTextViaSystemEvents(text) {
  const result = spawnSync(
    '/usr/bin/osascript',
    [
      '-e',
      'on run argv',
      '-e',
      'tell application "System Events" to keystroke (item 1 of argv)',
      '-e',
      'end run',
      text,
    ],
    {
      encoding: 'utf8',
      stdio: 'pipe',
    },
  )

  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(trimCommandFailure(result, 'System Events keystroke failed'))
  }
}

function runDriver(payload) {
  const swift = ensureSwiftDriver()
  if (swift.available) {
    return runSwiftDriver(payload)
  }

  try {
    return runJxaDriver(payload)
  } catch (error) {
    const details = String(error instanceof Error ? error.message : error)
    throw new Error(
      `Compiled input driver unavailable: ${swift.reason}; JXA fallback failed: ${details}`,
    )
  }
}

function moveMouse(x, y, dragButton = null) {
  runDriver({ op: 'moveMouse', x, y, dragButton })
}

function mouseButton(button, action, count) {
  runDriver({ op: 'mouseButton', button, action, count })
}

function mouseLocation() {
  return runDriver({ op: 'mouseLocation' })
}

function mouseScroll(amount, axis) {
  runDriver({ op: 'mouseScroll', amount, axis })
}

function typeText(text) {
  try {
    typeTextViaSystemEvents(text)
  } catch {
    runDriver({ op: 'typeText', text })
  }
}

function key(keyName, action) {
  runDriver({ op: 'key', key: keyName, action })
}

function keys(parts) {
  runDriver({ op: 'keys', keys: parts })
}

function getFrontmostAppInfo() {
  return runDriver({ op: 'frontmostAppInfo' })
}

export default {
  isSupported: process.platform === 'darwin',
  moveMouse,
  mouseButton,
  mouseLocation,
  mouseScroll,
  typeText,
  key,
  keys,
  getFrontmostAppInfo,
}
