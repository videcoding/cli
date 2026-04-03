import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getSessionId } from '../../src/bootstrap/state.ts'
import {
  enableDebugLogging,
  flushDebugLogs,
  getDebugFilePath,
  getDebugFilter,
  getDebugLogPath,
  getHasFormattedOutput,
  getMinDebugLogLevel,
  isDebugMode,
  isDebugToStdErr,
  logAntError,
  logForDebugging,
  setHasFormattedOutput,
} from '../../src/utils/debug.ts'
import { runCleanupFunctions } from '../../src/utils/cleanupRegistry.ts'
import {
  NodeFsOperations,
  setFsImplementation,
  setOriginalFsImplementation,
} from '../../src/utils/fsOperations.ts'

const originalEnv = { ...process.env }
const originalArgv = [...process.argv]
const tempDirs: string[] = []

function restoreProcessState() {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key]
    }
  }
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
  process.argv = [...originalArgv]
}

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'videcoding-cli-debug-'))
  tempDirs.push(dir)
  return dir
}

function clearMemoized(fn: unknown) {
  ;(
    fn as
      | (((...args: never[]) => unknown) & {
          cache?: { clear?: () => void }
        })
      | undefined
  )?.cache?.clear?.()
}

function resetDebugCaches() {
  clearMemoized(getMinDebugLogLevel)
  clearMemoized(isDebugMode)
  clearMemoized(getDebugFilter)
  clearMemoized(isDebugToStdErr)
  clearMemoized(getDebugFilePath)
  setHasFormattedOutput(false)
}

beforeEach(() => {
  restoreProcessState()
  resetDebugCaches()
  setOriginalFsImplementation()
})

afterEach(() => {
  restoreProcessState()
  resetDebugCaches()
  mock.restore()
  setOriginalFsImplementation()
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('debug utils', () => {
  test('parses debug flags, filters, file paths, and minimum log level', () => {
    process.env.CLAUDE_CODE_DEBUG_LOG_LEVEL = 'verbose'
    process.argv = [
      'bun',
      'test',
      '--debug=api,hooks',
      '--debug-to-stderr',
      '--debug-file',
      '/tmp/debug.log',
    ]
    resetDebugCaches()

    expect(getMinDebugLogLevel()).toBe('verbose')
    expect(getDebugFilter()).toEqual({
      include: ['api', 'hooks'],
      exclude: [],
      isExclusive: false,
    })
    expect(isDebugToStdErr()).toBe(true)
    expect(getDebugFilePath()).toBe('/tmp/debug.log')
    expect(isDebugMode()).toBe(true)

    process.env.CLAUDE_CODE_DEBUG_LOG_LEVEL = 'LOUD'
    process.argv = ['bun', 'test']
    resetDebugCaches()

    expect(getMinDebugLogLevel()).toBe('debug')
    expect(getDebugFilter()).toBeNull()
    expect(isDebugToStdErr()).toBe(false)
    expect(getDebugFilePath()).toBeNull()
  })

  test('supports inline debug-file flags and skips writes when debug logging is disabled', () => {
    process.argv = ['bun', 'test', '--debug-file=/tmp/inline-debug.log']
    resetDebugCaches()
    expect(getDebugFilePath()).toBe('/tmp/inline-debug.log')

    const stderrSpy = spyOn(process.stderr, 'write').mockImplementation(
      () => true,
    )

    process.env.NODE_ENV = 'test'
    process.env.USER_TYPE = 'ant'
    process.argv = ['bun', 'test']
    resetDebugCaches()
    logForDebugging('api: suppressed in tests')
    expect(stderrSpy).not.toHaveBeenCalled()

    process.env.NODE_ENV = 'production'
    process.env.USER_TYPE = 'external'
    process.argv = ['bun', 'test']
    resetDebugCaches()
    logForDebugging('api: suppressed without debug mode')
    expect(stderrSpy).not.toHaveBeenCalled()

    stderrSpy.mockRestore()
  })

  test('writes formatted debug output to stderr and respects log levels', () => {
    process.env.CLAUDE_CODE_DEBUG_LOG_LEVEL = 'error'
    process.env.USER_TYPE = 'ant'
    process.argv = ['bun', 'test', '--debug-to-stderr']
    resetDebugCaches()

    const stderrSpy = spyOn(process.stderr, 'write').mockImplementation(
      () => true,
    )

    expect(getHasFormattedOutput()).toBe(false)
    setHasFormattedOutput(true)
    expect(getHasFormattedOutput()).toBe(true)

    logForDebugging('api: skipped at warn level', { level: 'warn' })
    logForDebugging('api: first line\nsecond line', { level: 'error' })
    expect(stderrSpy).toHaveBeenCalledTimes(1)
    expect(stderrSpy.mock.calls[0]?.[0]).toContain(
      '[ERROR] "api: first line\\nsecond line"',
    )

    logAntError('background task', new Error('boom'))
    expect(stderrSpy).toHaveBeenCalledTimes(2)
    expect(stderrSpy.mock.calls[1]?.[0]).toContain('[ERROR] "')
    expect(stderrSpy.mock.calls[1]?.[0]).toContain(
      '[ANT-ONLY] background task stack trace:',
    )

    stderrSpy.mockRestore()
  })

  test('skips logging when process.versions is unavailable', () => {
    const originalVersions = process.versions
    const stderrSpy = spyOn(process.stderr, 'write').mockImplementation(
      () => true,
    )

    try {
      Object.defineProperty(process, 'versions', {
        configurable: true,
        value: undefined,
      })

      process.env.NODE_ENV = 'production'
      process.env.USER_TYPE = 'ant'
      process.argv = ['bun', 'test', '--debug-to-stderr']
      resetDebugCaches()

      logForDebugging('api: suppressed without process versions')
      expect(stderrSpy).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(process, 'versions', {
        configurable: true,
        value: originalVersions,
      })
      stderrSpy.mockRestore()
    }
  })

  test('buffers debug output to disk and flushes pending writes', async () => {
    const configDir = makeTempDir()
    process.env.NODE_ENV = 'production'
    process.env.USER_TYPE = 'ant'
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.argv = ['bun', 'test']
    resetDebugCaches()

    const debugLogPath = join(configDir, 'debug', `${getSessionId()}.txt`)

    expect(getDebugLogPath()).toBe(debugLogPath)

    logForDebugging('api: buffered message')
    await flushDebugLogs()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(readFileSync(debugLogPath, 'utf8')).toContain('api: buffered message')
    expect(existsSync(join(configDir, 'debug', 'latest'))).toBe(true)
    expect(readlinkSync(join(configDir, 'debug', 'latest'))).toBe(debugLogPath)

    await runCleanupFunctions()
  })

  test('writes to explicit debug files synchronously and ignores mkdir races', async () => {
    const logDir = makeTempDir()
    const nestedDir = join(logDir, 'explicit')
    const explicitPath = join(nestedDir, 'debug.log')
    const mkdirCalls: string[] = []
    const appendCalls: Array<{ path: string; content: string }> = []

    mkdirSync(nestedDir, { recursive: true })
    setFsImplementation({
      ...NodeFsOperations,
      mkdirSync(dirPath, options) {
        mkdirCalls.push(dirPath)
        throw Object.assign(new Error('already exists'), { code: 'EEXIST' })
      },
      appendFileSync(path, data, options) {
        appendCalls.push({ path, content: data })
        NodeFsOperations.appendFileSync(path, data, options)
      },
    })

    process.env.NODE_ENV = 'production'
    process.env.USER_TYPE = 'external'
    process.argv = ['bun', 'test', `--debug-file=${explicitPath}`]
    resetDebugCaches()

    logForDebugging('api: sync message')
    await flushDebugLogs()

    expect(mkdirCalls).toEqual([nestedDir])
    expect(appendCalls[0]?.path).toBe(explicitPath)
    expect(appendCalls[0]?.content).toContain('api: sync message')
    expect(readFileSync(explicitPath, 'utf8')).toContain('api: sync message')
  })

  test('enableDebugLogging reports whether debug mode was already active', () => {
    process.argv = ['bun', 'test']
    resetDebugCaches()

    expect(isDebugMode()).toBe(false)
    expect(enableDebugLogging()).toBe(false)
    clearMemoized(isDebugMode)
    expect(isDebugMode()).toBe(true)
  })
})
