import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test'
import * as nodeFs from 'node:fs'
import * as nodeFsPromises from 'node:fs/promises'
import {
  readFileSync as readNodeFileSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FsOperations } from '../../src/utils/fsOperations.ts'
import {
  NodeFsOperations,
  getPathsForPermissionCheck,
  isDuplicatePath,
  readFileRange,
  readLinesReverse,
  resolveDeepestExistingAncestorSync,
  safeResolvePath,
  setFsImplementation,
  setOriginalFsImplementation,
  tailFile,
} from '../../src/utils/fsOperations.ts'

const tempDirs: string[] = []

afterEach(() => {
  mock.restore()
  setOriginalFsImplementation()
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'videcoding-cli-fs-'))
  tempDirs.push(dir)
  return dir
}

describe('fsOperations', () => {
  test('safeResolvePath resolves symlinks and preserves canonical metadata', () => {
    const dir = makeTempDir()
    const target = join(dir, 'target.txt')
    const link = join(dir, 'link.txt')

    writeFileSync(target, 'hello')
    symlinkSync(target, link)

    const result = safeResolvePath(NodeFsOperations, link)

    expect(result.resolvedPath.endsWith('/target.txt')).toBe(true)
    expect(result.isSymlink).toBe(true)
    expect(result.isCanonical).toBe(true)
  })

  test('safeResolvePath short-circuits UNC paths and falls back cleanly on fs errors', () => {
    let lstatCalled = false
    const fakeFs = {
      lstatSync() {
        lstatCalled = true
        throw new Error('should not be called')
      },
      realpathSync() {
        throw new Error('should not be called')
      },
    } as FsOperations

    expect(safeResolvePath(fakeFs, '//server/share/file.txt')).toEqual({
      resolvedPath: '//server/share/file.txt',
      isSymlink: false,
      isCanonical: false,
    })
    expect(lstatCalled).toBe(false)

    const failingFs = {
      lstatSync() {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      },
      realpathSync() {
        throw new Error('unreachable')
      },
    } as FsOperations

    expect(safeResolvePath(failingFs, '/tmp/new-file.txt')).toEqual({
      resolvedPath: '/tmp/new-file.txt',
      isSymlink: false,
      isCanonical: false,
    })
  })

  test('safeResolvePath skips special file types before resolving', () => {
    let realpathCalled = false
    const fakeFs = {
      lstatSync() {
        return {
          isFIFO: () => true,
          isSocket: () => false,
          isCharacterDevice: () => false,
          isBlockDevice: () => false,
        }
      },
      realpathSync() {
        realpathCalled = true
        throw new Error('should not be called for FIFOs')
      },
    } as FsOperations

    expect(safeResolvePath(fakeFs, '/tmp/fake-pipe')).toEqual({
      resolvedPath: '/tmp/fake-pipe',
      isSymlink: false,
      isCanonical: false,
    })
    expect(realpathCalled).toBe(false)
  })

  test('deduplicates symlinked paths using the resolved target', () => {
    const dir = makeTempDir()
    const target = join(dir, 'target.txt')
    const link = join(dir, 'link.txt')
    const loadedPaths = new Set<string>()

    writeFileSync(target, 'hello')
    symlinkSync(target, link)

    expect(isDuplicatePath(NodeFsOperations, target, loadedPaths)).toBe(false)
    expect(isDuplicatePath(NodeFsOperations, link, loadedPaths)).toBe(true)
  })

  test('resolves the deepest existing symlinked ancestor for new file writes', () => {
    const dir = makeTempDir()
    const realDir = join(dir, 'real')
    const linkedDir = join(dir, 'linked-dir')

    mkdirSync(realDir)
    symlinkSync(realDir, linkedDir)

    const resolved = resolveDeepestExistingAncestorSync(
      NodeFsOperations,
      join(linkedDir, 'child.txt'),
    )

    expect(resolved?.endsWith('/real/child.txt')).toBe(true)
  })

  test('resolves dangling symlink ancestors when realpath fails', () => {
    const dir = makeTempDir()
    const danglingDir = join(dir, 'dangling-dir')

    symlinkSync('missing-target', danglingDir, 'dir')

    const resolved = resolveDeepestExistingAncestorSync(
      NodeFsOperations,
      join(danglingDir, 'child.txt'),
    )

    expect(resolved).toBe(join(dir, 'missing-target', 'child.txt'))
  })

  test('returns undefined when ancestor resolution finds no symlink or cannot resolve a real path', () => {
    const samePathFs = {
      lstatSync() {
        return {
          isSymbolicLink: () => false,
        }
      },
      realpathSync(path: string) {
        return path
      },
    } as FsOperations

    expect(
      resolveDeepestExistingAncestorSync(samePathFs, '/tmp/plain/child.txt'),
    ).toBeUndefined()

    const failingFs = {
      lstatSync() {
        return {
          isSymbolicLink: () => false,
        }
      },
      realpathSync() {
        throw Object.assign(new Error('denied'), { code: 'EACCES' })
      },
    } as FsOperations

    expect(
      resolveDeepestExistingAncestorSync(failingFs, '/tmp/plain/child.txt'),
    ).toBeUndefined()
  })

  test('collects original, intermediate, and canonical paths for permission checks', () => {
    const dir = makeTempDir()
    const target = join(dir, 'target.txt')
    const link = join(dir, 'link.txt')

    writeFileSync(target, 'hello')
    symlinkSync(target, link)

    const paths = getPathsForPermissionCheck(link)

    expect(paths[0]).toBe(link)
    expect(paths.some(path => path.endsWith('/target.txt'))).toBe(true)
    expect(paths.length).toBeGreaterThanOrEqual(2)
  })

  test('adds resolved destinations for new files behind symlinked parent directories', () => {
    const dir = makeTempDir()
    const realDir = join(dir, 'real')
    const linkedDir = join(dir, 'linked')
    const intendedPath = join(linkedDir, 'child.txt')

    mkdirSync(realDir)
    symlinkSync(realDir, linkedDir, 'dir')

    const paths = getPathsForPermissionCheck(intendedPath)

    expect(paths[0]).toBe(intendedPath)
    expect(paths).toContain(
      join(NodeFsOperations.realpathSync(realDir), 'child.txt'),
    )
  })

  test('expands home shortcuts and short-circuits UNC paths for permission checks', () => {
    let existsCalled = false
    setFsImplementation({
      ...NodeFsOperations,
      existsSync(path) {
        existsCalled = true
        return NodeFsOperations.existsSync(path)
      },
    })

    expect(getPathsForPermissionCheck('~')).toEqual([homedir().normalize('NFC')])
    expect(getPathsForPermissionCheck('~/notes.txt')[0]).toBe(
      join(homedir().normalize('NFC'), 'notes.txt'),
    )

    existsCalled = false
    expect(getPathsForPermissionCheck('//server/share/file.txt')).toEqual([
      '//server/share/file.txt',
    ])
    expect(existsCalled).toBe(false)
  })

  test('supports append, partial reads, tailing, and reverse line iteration', async () => {
    const dir = makeTempDir()
    const textFile = join(dir, 'sample.txt')
    const longFile = join(dir, 'history.log')
    const longLine = 'a'.repeat(3000) + '界'.repeat(1500)

    NodeFsOperations.appendFileSync(textFile, 'abc', { mode: 0o600 })
    NodeFsOperations.appendFileSync(textFile, 'def', { mode: 0o600 })

    expect(NodeFsOperations.readFileSync(textFile, { encoding: 'utf8' })).toBe(
      'abcdef',
    )
    expect(statSync(textFile).mode & 0o777).toBe(0o600)

    const syncRead = NodeFsOperations.readSync(textFile, { length: 3 })
    expect(syncRead.bytesRead).toBe(3)
    expect(syncRead.buffer.toString('utf8', 0, syncRead.bytesRead)).toBe('abc')

    expect(
      (await NodeFsOperations.readFileBytes(textFile, 4)).toString('utf8'),
    ).toBe('abcd')

    expect(await readFileRange(textFile, 2, 3)).toEqual({
      content: 'cde',
      bytesRead: 3,
      bytesTotal: 6,
    })
    expect(await readFileRange(textFile, 10, 3)).toBeNull()

    expect(await tailFile(textFile, 3)).toEqual({
      content: 'def',
      bytesRead: 3,
      bytesTotal: 6,
    })

    writeFileSync(longFile, `${longLine}\nsecond\n\nthird`)
    const reversedLines: string[] = []
    for await (const line of readLinesReverse(longFile)) {
      reversedLines.push(line)
    }

    expect(reversedLines).toEqual(['third', 'second', longLine])
  })

  test('reports directory contents and empty state through NodeFsOperations helpers', () => {
    const dir = makeTempDir()
    const nestedDir = join(dir, 'nested')
    const file = join(nestedDir, 'note.txt')

    NodeFsOperations.mkdirSync(nestedDir)
    expect(NodeFsOperations.isDirEmptySync(nestedDir)).toBe(true)

    writeFileSync(file, 'hello')

    expect(NodeFsOperations.isDirEmptySync(nestedDir)).toBe(false)
    expect(NodeFsOperations.readdirStringSync(nestedDir)).toEqual(['note.txt'])
    expect(
      NodeFsOperations.readdirSync(nestedDir).map(entry => entry.name),
    ).toEqual(['note.txt'])
  })

  test('supports core async lifecycle operations and link helpers', async () => {
    const dir = makeTempDir()
    const sourceDir = join(dir, 'source')
    const renamedDir = join(dir, 'renamed')
    const file = join(sourceDir, 'note.txt')
    const renamedFile = join(sourceDir, 'renamed.txt')
    const copiedFile = join(sourceDir, 'copied.txt')
    const hardLinkedFile = join(sourceDir, 'linked.txt')
    const symlinkedFile = join(sourceDir, 'symlinked.txt')

    await NodeFsOperations.mkdir(sourceDir, { mode: 0o755 })
    expect((await NodeFsOperations.stat(sourceDir)).isDirectory()).toBe(true)

    await new Promise<void>((resolve, reject) => {
      const stream = NodeFsOperations.createWriteStream(file)
      stream.on('error', reject)
      stream.on('finish', () => resolve())
      stream.end('hello world')
    })

    expect(await NodeFsOperations.readFile(file, { encoding: 'utf8' })).toBe(
      'hello world',
    )
    expect(
      (await NodeFsOperations.readFileBytes(file)).toString('utf8'),
    ).toBe('hello world')
    expect((await NodeFsOperations.readdir(sourceDir)).map(entry => entry.name)).toEqual([
      'note.txt',
    ])

    await NodeFsOperations.rename(file, renamedFile)
    expect(NodeFsOperations.existsSync(renamedFile)).toBe(true)

    NodeFsOperations.copyFileSync(renamedFile, copiedFile)
    NodeFsOperations.linkSync(renamedFile, hardLinkedFile)
    NodeFsOperations.symlinkSync(renamedFile, symlinkedFile, 'file')
    expect(NodeFsOperations.readlinkSync(symlinkedFile)).toBe(renamedFile)

    await NodeFsOperations.unlink(hardLinkedFile)
    NodeFsOperations.unlinkSync(copiedFile)
    NodeFsOperations.unlinkSync(symlinkedFile)
    expect(NodeFsOperations.existsSync(hardLinkedFile)).toBe(false)
    expect(NodeFsOperations.existsSync(copiedFile)).toBe(false)
    expect(NodeFsOperations.existsSync(symlinkedFile)).toBe(false)

    await NodeFsOperations.rename(sourceDir, renamedDir)
    expect(NodeFsOperations.existsSync(renamedDir)).toBe(true)

    await NodeFsOperations.unlink(join(renamedDir, 'renamed.txt'))
    await NodeFsOperations.rmdir(renamedDir)
    expect(NodeFsOperations.existsSync(renamedDir)).toBe(false)

    const recursiveDir = join(dir, 'recursive')
    await NodeFsOperations.mkdir(join(recursiveDir, 'nested'))
    writeFileSync(join(recursiveDir, 'nested', 'file.txt'), 'x')
    await NodeFsOperations.rm(recursiveDir, { recursive: true, force: true })
    expect(NodeFsOperations.existsSync(recursiveDir)).toBe(false)

    const syncDir = join(dir, 'sync')
    const emptySyncDir = join(syncDir, 'empty')
    NodeFsOperations.mkdirSync(syncDir, { mode: 0o700 })
    expect(statSync(syncDir).mode & 0o777).toBe(0o700)
    writeFileSync(join(syncDir, 'file.txt'), 'x')
    expect(NodeFsOperations.statSync(syncDir).isDirectory()).toBe(true)
    expect(
      NodeFsOperations.readFileBytesSync(join(syncDir, 'file.txt')).toString(
        'utf8',
      ),
    ).toBe('x')
    NodeFsOperations.renameSync(
      join(syncDir, 'file.txt'),
      join(syncDir, 'renamed-sync.txt'),
    )
    expect(
      readNodeFileSync(join(syncDir, 'renamed-sync.txt'), 'utf8'),
    ).toBe('x')
    NodeFsOperations.mkdirSync(emptySyncDir)
    NodeFsOperations.rmdirSync(emptySyncDir)
    NodeFsOperations.rmSync(syncDir, { recursive: true, force: true })
    expect(NodeFsOperations.existsSync(syncDir)).toBe(false)
  })

  test('ignores EEXIST from recursive mkdir wrappers and exposes cwd', async () => {
    const mkdirSpy = spyOn(nodeFsPromises, 'mkdir').mockRejectedValueOnce(
      Object.assign(new Error('exists'), { code: 'EEXIST' }),
    )
    const mkdirSyncSpy = spyOn(nodeFs, 'mkdirSync').mockImplementation(() => {
      throw Object.assign(new Error('exists'), { code: 'EEXIST' })
    })

    await expect(NodeFsOperations.mkdir('/tmp/already-there')).resolves.toBe(
      undefined,
    )
    expect(() => NodeFsOperations.mkdirSync('/tmp/already-there')).not.toThrow()
    expect(NodeFsOperations.cwd()).toBe(process.cwd())
    expect(mkdirSpy).toHaveBeenCalledTimes(1)
    expect(mkdirSyncSpy).toHaveBeenCalledTimes(1)
  })
})
