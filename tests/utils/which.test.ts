import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findExecutable } from '../../src/utils/findExecutable.ts'
import { which, whichSync } from '../../src/utils/which.ts'

const originalEnv = { ...process.env }
const tempDirs: string[] = []

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
  const dir = mkdtempSync(join(tmpdir(), 'videcoding-cli-which-'))
  tempDirs.push(dir)
  return dir
}

beforeEach(restoreEnv)

afterEach(() => {
  restoreEnv()
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('which', () => {
  test('resolves a real runtime executable asynchronously and synchronously', async () => {
    const bunPath = await which('bun')

    expect(bunPath).toBeTruthy()
    expect(whichSync('bun')).toBe(bunPath)
    expect(findExecutable('bun', ['--flag'])).toEqual({
      cmd: bunPath ?? 'bun',
      args: ['--flag'],
    })
  })

  test('returns null for missing commands and preserves the original executable name', async () => {
    process.env.PATH = makeTempDir()

    expect(await which('missing-tool')).toBeNull()
    expect(whichSync('missing-tool')).toBeNull()
    expect(findExecutable('missing-tool', ['arg'])).toEqual({
      cmd: 'missing-tool',
      args: ['arg'],
    })
  })
})
