import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  SLOW_OPERATION_THRESHOLD_MS,
  callerFrame,
  clone,
  cloneDeep,
  jsonParse,
  jsonStringify,
  slowLogging,
  writeFileSync_DEPRECATED,
} from '../../src/utils/slowOperations.ts'

const tempDirs: string[] = []
const originalEnv = { ...process.env }
const thresholdEnvKeys = [
  'CLAUDE_CODE_SLOW_OPERATION_THRESHOLD_MS',
  'NODE_ENV',
  'USER_TYPE',
] as const

let slowOperationsImportCounter = 0

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

async function importFreshSlowOperations(
  envOverrides: Record<string, string | undefined>,
) {
  const moduleUrl = new URL('../../src/utils/slowOperations.ts', import.meta.url)
    .href
  const childEnv: Record<string, string> = {}

  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      childEnv[key] = value
    }
  }
  for (const key of thresholdEnvKeys) {
    delete childEnv[key]
  }
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) {
      delete childEnv[key]
    } else {
      childEnv[key] = value
    }
  }

  slowOperationsImportCounter += 1
  const result = Bun.spawnSync({
    cmd: [
      process.execPath,
      '-e',
      `const mod = await import(${JSON.stringify(moduleUrl)}); process.stdout.write(JSON.stringify({ threshold: mod.SLOW_OPERATION_THRESHOLD_MS }))`,
    ],
    env: childEnv,
    stdout: 'pipe',
    stderr: 'pipe',
  })

  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString())
  }

  return JSON.parse(result.stdout.toString()) as { threshold: number | null }
}

beforeEach(() => {
  restoreEnv()
})

afterEach(() => {
  restoreEnv()
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('slowOperations', () => {
  test('wraps JSON parse/stringify and clone helpers without changing semantics', () => {
    expect(jsonStringify({ a: 1, b: [2, 3] })).toBe('{"a":1,"b":[2,3]}')
    expect(jsonParse('{"a":1,"b":[2,3]}')).toEqual({ a: 1, b: [2, 3] })
    expect(
      jsonParse('{"date":"2024-01-02T03:04:05.678Z"}', (key, value) =>
        key === 'date' ? new Date(value as string) : value,
      ),
    ).toEqual({
      date: new Date('2024-01-02T03:04:05.678Z'),
    })

    const original = {
      nested: { count: 1 },
      list: [1, 2, 3],
    }
    const structured = clone(original)
    const deep = cloneDeep(original)

    structured.nested.count = 2
    deep.list.push(4)

    expect(original.nested.count).toBe(1)
    expect(original.list).toEqual([1, 2, 3])
  })

  test('extracts caller frames from stacks outside slowOperations', () => {
    const stack = [
      'Error: failed',
      '    at slowOperations.ts:10:1',
      '    at /tmp/caller.ts:42:7',
      '    at /tmp/other.ts:80:2',
    ].join('\n')

    expect(callerFrame(stack)).toBe(' @ caller.ts:42')
    expect(callerFrame(undefined)).toBe('')
    expect(callerFrame('Error\n    at slowOperations.ts:10:1')).toBe('')
  })

  test('selects slow-operation thresholds from env overrides and runtime defaults', async () => {
    expect(SLOW_OPERATION_THRESHOLD_MS).toBe(Infinity)
    expect(
      (
        await importFreshSlowOperations({
          CLAUDE_CODE_SLOW_OPERATION_THRESHOLD_MS: '15',
        })
      ).threshold,
    ).toBe(15)
    expect(
      (
        await importFreshSlowOperations({
          CLAUDE_CODE_SLOW_OPERATION_THRESHOLD_MS: '-1',
          NODE_ENV: 'development',
        })
      ).threshold,
    ).toBe(20)
    expect(
      (
        await importFreshSlowOperations({
          CLAUDE_CODE_SLOW_OPERATION_THRESHOLD_MS: 'invalid',
          NODE_ENV: 'production',
          USER_TYPE: 'ant',
        })
      ).threshold,
    ).toBe(300)
    expect(
      (
        await importFreshSlowOperations({
          NODE_ENV: 'production',
          USER_TYPE: 'external',
        })
      ).threshold,
    ).toBeNull()
  })

  test('returns a disposable slow logger on the fast path', () => {
    const logger = slowLogging`noop ${[1, 2, 3]} ${'value'}`
    expect(() => logger[Symbol.dispose]()).not.toThrow()
  })

  test('writes files with and without fsync flushing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'videcoding-cli-slow-ops-'))
    tempDirs.push(dir)

    const regularFile = join(dir, 'regular.txt')
    const flushedFile = join(dir, 'flushed.txt')

    writeFileSync_DEPRECATED(regularFile, 'regular')
    writeFileSync_DEPRECATED(flushedFile, 'flushed', { flush: true })

    expect(readFileSync(regularFile, 'utf8')).toBe('regular')
    expect(readFileSync(flushedFile, 'utf8')).toBe('flushed')
  })
})
