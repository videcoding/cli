import { afterEach, describe, expect, test } from 'bun:test'
import { CACHE_PATHS } from '../../src/utils/cachePaths.ts'
import type { FsOperations } from '../../src/utils/fsOperations.ts'
import {
  setFsImplementation,
  setOriginalFsImplementation,
} from '../../src/utils/fsOperations.ts'

afterEach(() => {
  setOriginalFsImplementation()
})

function createStubFs(cwdValue: string): FsOperations {
  const fail = () => {
    throw new Error('not implemented')
  }

  return {
    cwd: () => cwdValue,
    existsSync: () => false,
    stat: fail,
    readdir: fail,
    unlink: fail,
    rmdir: fail,
    rm: fail,
    mkdir: fail,
    readFile: fail,
    rename: fail,
    statSync: fail,
    lstatSync: fail,
    readFileSync: fail,
    readFileBytesSync: fail,
    readSync: fail,
    appendFileSync: fail,
    copyFileSync: fail,
    unlinkSync: fail,
    renameSync: fail,
    linkSync: fail,
    symlinkSync: fail,
    readlinkSync: fail,
    realpathSync: fail,
    mkdirSync: fail,
    readdirSync: fail,
    readdirStringSync: fail,
    isDirEmptySync: fail,
    rmdirSync: fail,
    rmSync: fail,
    createWriteStream: fail,
    readFileBytes: fail,
  }
}

describe('CACHE_PATHS', () => {
  test('derives stable cache paths from cwd and sanitizes server names', () => {
    setFsImplementation(createStubFs('/tmp/project with spaces'))

    expect(CACHE_PATHS.baseLogs()).toContain('-tmp-project-with-spaces')
    expect(CACHE_PATHS.errors()).toContain('/errors')
    expect(CACHE_PATHS.messages()).toContain('/messages')
    expect(CACHE_PATHS.mcpLogs('server:name/with spaces')).toContain(
      'mcp-logs-server-name-with-spaces',
    )
  })

  test('truncates extremely long project paths while keeping them stable', () => {
    const longCwd = `/tmp/${'a'.repeat(260)}/project`
    setFsImplementation(createStubFs(longCwd))

    const base = CACHE_PATHS.baseLogs()

    expect(base).toContain('-wn9u9d')
    expect(base.length).toBeLessThan(longCwd.length + 80)
  })
})
