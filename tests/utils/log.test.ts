import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LogOption } from '../../src/types/logs.ts'
import {
  getLastAPIRequest,
  getLastAPIRequestMessages,
  resetStateForTests,
} from '../../src/bootstrap/state.ts'

const originalEnv = { ...process.env }
const originalCwd = process.cwd()
const tempDirs: string[] = []
const cachePathsModuleUrl = new URL(
  '../../src/utils/cachePaths.js',
  import.meta.url,
).href
const logModuleUrl = new URL('../../src/utils/log.ts', import.meta.url).href
let logModuleImportCounter = 0
let currentErrorsDir = join(tmpdir(), 'videcoding-cli-log-default-errors')

function restoreEnv() {
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
}

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'videcoding-cli-log-'))
  tempDirs.push(dir)
  return dir
}

async function loadFreshLogModule(errorsDir?: string) {
  currentErrorsDir = errorsDir ?? join(makeTempDir(), 'errors')
  mock.module(cachePathsModuleUrl, () => ({
    CACHE_PATHS: {
      errors: () => currentErrorsDir,
    },
  }))

  logModuleImportCounter += 1
  const module = (await import(
    `${logModuleUrl}?case=${logModuleImportCounter}`
  )) as typeof import('../../src/utils/log.ts')
  module._resetErrorLogForTesting()
  return module
}

function makeBaseLog(overrides: Partial<LogOption> = {}): LogOption {
  return {
    date: '2024-01-01T00-00-00-000Z',
    messages: [],
    value: 0,
    created: new Date('2024-01-01T00:00:00.000Z'),
    modified: new Date('2024-01-01T00:00:00.000Z'),
    firstPrompt: 'Explain the code',
    messageCount: 1,
    isSidechain: false,
    sessionId: '12345678-1234-1234-1234-123456789012',
    ...overrides,
  }
}

beforeEach(() => {
  restoreEnv()
  resetStateForTests()
})

afterEach(() => {
  restoreEnv()
  process.chdir(originalCwd)
  mock.restore()
  resetStateForTests()
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('log utils', () => {
  test('formats log display titles with tag stripping and sensible fallbacks', async () => {
    const logModule = await loadFreshLogModule()

    expect(
      logModule.getLogDisplayTitle(
        makeBaseLog({
          firstPrompt: '<command-name>/clear</command-name>',
          customTitle: 'Custom Title',
        }),
      ),
    ).toBe('Custom Title')

    expect(
      logModule.getLogDisplayTitle(
        makeBaseLog({
          firstPrompt: '<tick>Autonomous task</tick>',
        }),
      ),
    ).toBe('Autonomous session')

    expect(
      logModule.getLogDisplayTitle(
        makeBaseLog({
          firstPrompt: '<ide_opened_file>src/index.ts</ide_opened_file>Read file',
          customTitle: undefined,
          summary: undefined,
        }),
      ),
    ).toBe('Read file')

    expect(
      logModule.getLogDisplayTitle(
        makeBaseLog({
          firstPrompt: '',
          summary: undefined,
          customTitle: undefined,
          sessionId: 'abcdef1234567890',
        }),
      ),
    ).toBe('abcdef12')
  })

  test('formats dates for filenames in an ISO-safe way', async () => {
    const logModule = await loadFreshLogModule()

    expect(logModule.dateToFilename(new Date('2024-01-02T03:04:05.678Z'))).toBe(
      '2024-01-02T03-04-05-678Z',
    )
  })

  test('queues error and MCP events until a sink attaches, then drains once', async () => {
    const logModule = await loadFreshLogModule()
    const sink = {
      logError: mock(() => {}),
      logMCPError: mock(() => {}),
      logMCPDebug: mock(() => {}),
      getErrorsPath: mock(() => '/tmp/errors'),
      getMCPLogsPath: mock((serverName: string) => `/tmp/${serverName}.log`),
    }
    const secondSink = {
      logError: mock(() => {}),
      logMCPError: mock(() => {}),
      logMCPDebug: mock(() => {}),
      getErrorsPath: mock(() => '/tmp/errors-2'),
      getMCPLogsPath: mock((serverName: string) => `/tmp/${serverName}-2.log`),
    }

    logModule.logError(new Error('queued error'))
    logModule.logMCPError('github', new Error('mcp failed'))
    logModule.logMCPDebug('github', 'debug line')

    expect(logModule.getInMemoryErrors()).toHaveLength(1)

    logModule.attachErrorLogSink(sink)
    logModule.attachErrorLogSink(secondSink)

    expect(sink.logError).toHaveBeenCalledTimes(1)
    expect(sink.logMCPError).toHaveBeenCalledTimes(1)
    expect(sink.logMCPDebug).toHaveBeenCalledTimes(1)
    expect(secondSink.logError).not.toHaveBeenCalled()

    logModule.logError(new Error('post-attach'))
    logModule.logMCPError('github', new Error('attached mcp failed'))
    logModule.logMCPDebug('github', 'attached debug line')
    expect(sink.logError).toHaveBeenCalledTimes(2)
    expect(sink.logMCPError).toHaveBeenCalledTimes(2)
    expect(sink.logMCPDebug).toHaveBeenCalledTimes(2)
  })

  test('swallows sink exceptions without crashing error reporting', async () => {
    const logModule = await loadFreshLogModule()
    const sink = {
      logError: mock(() => {
        throw new Error('sink failed')
      }),
      logMCPError: mock(() => {
        throw new Error('mcp sink failed')
      }),
      logMCPDebug: mock(() => {
        throw new Error('debug sink failed')
      }),
      getErrorsPath: mock(() => '/tmp/errors'),
      getMCPLogsPath: mock((serverName: string) => `/tmp/${serverName}.log`),
    }

    logModule.attachErrorLogSink(sink)

    expect(() => logModule.logError(new Error('boom'))).not.toThrow()
    expect(() => logModule.logMCPError('github', new Error('mcp boom'))).not.toThrow()
    expect(() => logModule.logMCPDebug('github', 'debug boom')).not.toThrow()
    expect(logModule.getInMemoryErrors()).toHaveLength(1)
  })

  test('caps in-memory errors at the most recent 100 entries', async () => {
    const logModule = await loadFreshLogModule()
    const sink = {
      logError: mock(() => {}),
      logMCPError: mock(() => {}),
      logMCPDebug: mock(() => {}),
      getErrorsPath: mock(() => '/tmp/errors'),
      getMCPLogsPath: mock((serverName: string) => `/tmp/${serverName}.log`),
    }

    logModule.attachErrorLogSink(sink)

    for (let i = 0; i < 101; i++) {
      logModule.logError(new Error(`error-${i}`))
    }

    const inMemory = logModule.getInMemoryErrors()
    expect(inMemory).toHaveLength(100)
    expect(inMemory[0]?.error).toContain('error-1')
    expect(inMemory.at(-1)?.error).toContain('error-100')
  })

  test('skips error logging when reporting is disabled or essential-only mode is active', async () => {
    const logModule = await loadFreshLogModule()
    const sink = {
      logError: mock(() => {}),
      logMCPError: mock(() => {}),
      logMCPDebug: mock(() => {}),
      getErrorsPath: mock(() => '/tmp/errors'),
      getMCPLogsPath: mock((serverName: string) => `/tmp/${serverName}.log`),
    }

    logModule.attachErrorLogSink(sink)

    process.env.DISABLE_ERROR_REPORTING = '1'
    logModule.logError(new Error('disabled'))
    expect(logModule.getInMemoryErrors()).toHaveLength(0)
    expect(sink.logError).not.toHaveBeenCalled()

    delete process.env.DISABLE_ERROR_REPORTING
    process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
    logModule.logError(new Error('essential-only'))
    expect(logModule.getInMemoryErrors()).toHaveLength(0)
    expect(sink.logError).not.toHaveBeenCalled()
  })

  test('captures last API request only for main-thread sources and only stores messages for ant users', async () => {
    const logModule = await loadFreshLogModule()
    const params = {
      model: 'claude-sonnet-4-6',
      max_tokens: 256,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Hello' }],
        },
      ],
    } as never

    logModule.captureAPIRequest(params, 'sdk' as never)
    expect(getLastAPIRequest()).toBeNull()
    expect(getLastAPIRequestMessages()).toBeNull()

    process.env.USER_TYPE = 'external'
    logModule.captureAPIRequest(params, 'repl_main_thread:outputStyle:custom' as never)
    expect(getLastAPIRequest()).toEqual({
      model: 'claude-sonnet-4-6',
      max_tokens: 256,
    })
    expect(getLastAPIRequestMessages()).toBeNull()

    process.env.USER_TYPE = 'ant'
    logModule.captureAPIRequest(params, 'repl_main_thread' as never)
    expect(getLastAPIRequestMessages()).toEqual(params.messages)
  })

  test('loads error logs from disk, sorts them, and resolves by index', async () => {
    const errorsDir = makeTempDir()
    const logModule = await loadFreshLogModule(errorsDir)
    const longPrompt =
      'Newest prompt that should be truncated because it is definitely longer than fifty characters'
    const olderPath = join(errorsDir, 'older.json')
    const newerPath = join(errorsDir, 'newer-sidechain.json')
    const emptyPath = join(errorsDir, 'empty.json')

    mkdirSync(errorsDir, { recursive: true })
    writeFileSync(
      olderPath,
      JSON.stringify([
        {
          type: 'assistant',
          message: { content: [] },
          timestamp: '2024-01-01T00:00:00.000Z',
        },
        {
          type: 'assistant',
          message: { content: [] },
          timestamp: '2024-01-01T00:05:00.000Z',
        },
      ]),
    )
    writeFileSync(
      newerPath,
      JSON.stringify([
        {
          type: 'user',
          message: { content: longPrompt },
          timestamp: '2024-01-02T00:00:00.000Z',
        },
        {
          type: 'assistant',
          message: { content: [] },
          timestamp: '2024-01-02T00:10:00.000Z',
        },
      ]),
    )
    writeFileSync(emptyPath, JSON.stringify([]))

    utimesSync(
      olderPath,
      new Date('2024-01-01T00:10:00.000Z'),
      new Date('2024-01-01T00:10:00.000Z'),
    )
    utimesSync(
      newerPath,
      new Date('2024-01-02T00:10:00.000Z'),
      new Date('2024-01-02T00:10:00.000Z'),
    )
    utimesSync(
      emptyPath,
      new Date('2024-01-01T00:20:00.000Z'),
      new Date('2024-01-01T00:20:00.000Z'),
    )

    const logs = await logModule.loadErrorLogs()

    expect(logs).toHaveLength(3)
    expect(logs[0]).toMatchObject({
      fullPath: newerPath,
      firstPrompt: `${longPrompt.slice(0, 50)}…`,
      isSidechain: true,
      value: 0,
      messageCount: 2,
    })
    expect(logs[0]?.created.toISOString()).toBe('2024-01-02T00:00:00.000Z')
    expect(logs[0]?.modified.toISOString()).toBe('2024-01-02T00:10:00.000Z')

    expect(logs[1]).toMatchObject({
      fullPath: emptyPath,
      firstPrompt: 'No prompt',
      isSidechain: false,
      value: 1,
      messageCount: 0,
    })
    expect(logs[1]?.created.toISOString()).toBe('2024-01-01T00:20:00.000Z')
    expect(logs[1]?.modified.toISOString()).toBe('2024-01-01T00:20:00.000Z')

    expect(logs[2]).toMatchObject({
      fullPath: olderPath,
      firstPrompt: 'No prompt',
      value: 2,
      messageCount: 2,
    })
    expect(await logModule.getErrorLogByIndex(0)).toMatchObject({
      fullPath: newerPath,
    })
    expect(await logModule.getErrorLogByIndex(99)).toBeNull()
  })

  test('returns an empty list when no error logs exist yet', async () => {
    const errorsDir = join(makeTempDir(), 'missing-errors')
    const logModule = await loadFreshLogModule(errorsDir)

    expect(await logModule.loadErrorLogs()).toEqual([])
    expect(await logModule.getErrorLogByIndex(0)).toBeNull()
    expect(logModule.getInMemoryErrors()[0]?.error).toContain(errorsDir)
  })
})
