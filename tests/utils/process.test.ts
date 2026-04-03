import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import {
  exitWithError,
  peekForStdinData,
  registerProcessOutputErrorHandlers,
  writeToStderr,
  writeToStdout,
} from '../../src/utils/process.ts'

const originalExit = process.exit

afterEach(() => {
  process.exit = originalExit
})

describe('process utils', () => {
  test('times out when stdin stays idle', async () => {
    const stream = new EventEmitter()
    await expect(peekForStdinData(stream, 10)).resolves.toBe(true)
  })

  test('returns false when stdin ends before timeout', async () => {
    const stream = new EventEmitter()
    const pending = peekForStdinData(stream, 50)

    setTimeout(() => {
      stream.emit('end')
    }, 5)

    await expect(pending).resolves.toBe(false)
  })

  test('waits for end after the first data event', async () => {
    const stream = new EventEmitter()
    const pending = peekForStdinData(stream, 10)

    setTimeout(() => {
      stream.emit('data', 'chunk')
      setTimeout(() => {
        stream.emit('end')
      }, 10)
    }, 1)

    await expect(pending).resolves.toBe(false)
  })

  test('writes error text and exits in exitWithError', () => {
    const consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {})
    const exitSpy = mock(() => {
      throw new Error('process.exit intercepted')
    })
    process.exit = exitSpy as typeof process.exit

    expect(() => exitWithError('fatal')).toThrow('process.exit intercepted')
    expect(consoleErrorSpy).toHaveBeenCalledWith('fatal')
    expect(exitSpy).toHaveBeenCalledWith(1)

    consoleErrorSpy.mockRestore()
  })

  test('writes to stdout and stderr when streams are available', () => {
    const stdoutSpy = spyOn(process.stdout, 'write').mockImplementation(
      () => true,
    )
    const stderrSpy = spyOn(process.stderr, 'write').mockImplementation(
      () => true,
    )

    writeToStdout('hello')
    writeToStderr('oops')

    expect(stdoutSpy).toHaveBeenCalledWith('hello')
    expect(stderrSpy).toHaveBeenCalledWith('oops')

    stdoutSpy.mockRestore()
    stderrSpy.mockRestore()
  })

  test('destroys stdio streams on EPIPE output errors', () => {
    const stdoutBefore = process.stdout.listeners('error')
    const stderrBefore = process.stderr.listeners('error')
    const stdoutDestroySpy = spyOn(process.stdout, 'destroy').mockImplementation(
      () => process.stdout,
    )
    const stderrDestroySpy = spyOn(process.stderr, 'destroy').mockImplementation(
      () => process.stderr,
    )

    registerProcessOutputErrorHandlers()

    const stdoutHandler = process
      .stdout
      .listeners('error')
      .find(listener => !stdoutBefore.includes(listener))
    const stderrHandler = process
      .stderr
      .listeners('error')
      .find(listener => !stderrBefore.includes(listener))

    expect(stdoutHandler).toBeTruthy()
    expect(stderrHandler).toBeTruthy()

    ;(stdoutHandler as (error: NodeJS.ErrnoException) => void)({
      name: 'Error',
      message: 'broken pipe',
      code: 'EPIPE',
    })
    ;(stderrHandler as (error: NodeJS.ErrnoException) => void)({
      name: 'Error',
      message: 'broken pipe',
      code: 'EPIPE',
    })

    expect(stdoutDestroySpy).toHaveBeenCalled()
    expect(stderrDestroySpy).toHaveBeenCalled()

    process.stdout.off('error', stdoutHandler!)
    process.stderr.off('error', stderrHandler!)
    stdoutDestroySpy.mockRestore()
    stderrDestroySpy.mockRestore()
  })
})
