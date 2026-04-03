import { describe, expect, test } from 'bun:test'
import { APIUserAbortError } from '@anthropic-ai/sdk'
import {
  AbortError,
  ClaudeError,
  ConfigParseError,
  ShellError,
  TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  TeleportOperationError,
  classifyAxiosError,
  errorMessage,
  getErrnoCode,
  getErrnoPath,
  hasExactErrorMessage,
  isAbortError,
  isENOENT,
  isFsInaccessible,
  shortErrorStack,
  toError,
} from '../../src/utils/errors.ts'

describe('errors', () => {
  test('preserves custom error metadata and names', () => {
    const claudeError = new ClaudeError('boom')
    const configError = new ConfigParseError('bad config', '/tmp/settings.json', {
      mode: 'default',
    })
    const shellError = new ShellError('out', 'err', 7, true)
    const teleportError = new TeleportOperationError('fail', 'formatted fail')
    const telemetrySafeError =
      new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
        'full message',
        'telemetry message',
      )

    expect(claudeError.name).toBe('ClaudeError')
    expect(configError.filePath).toBe('/tmp/settings.json')
    expect(configError.defaultConfig).toEqual({ mode: 'default' })
    expect(shellError.stdout).toBe('out')
    expect(shellError.stderr).toBe('err')
    expect(shellError.code).toBe(7)
    expect(shellError.interrupted).toBe(true)
    expect(teleportError.formattedMessage).toBe('formatted fail')
    expect(telemetrySafeError.telemetryMessage).toBe('telemetry message')
  })

  test('recognizes abort-shaped errors', () => {
    const domAbort = new Error('aborted')
    domAbort.name = 'AbortError'
    const apiAbort = Object.create(
      APIUserAbortError.prototype,
    ) as APIUserAbortError

    expect(isAbortError(new AbortError('stop'))).toBe(true)
    expect(isAbortError(domAbort)).toBe(true)
    expect(isAbortError(apiAbort)).toBe(true)
    expect(isAbortError(new Error('other'))).toBe(false)
  })

  test('normalizes and classifies general errors', () => {
    const enoent = Object.assign(new Error('missing'), {
      code: 'ENOENT',
      path: '/tmp/missing',
    })
    const eacces = Object.assign(new Error('denied'), { code: 'EACCES' })

    expect(hasExactErrorMessage(new Error('same'), 'same')).toBe(true)
    expect(toError('boom').message).toBe('boom')
    expect(errorMessage('boom')).toBe('boom')
    expect(getErrnoCode(enoent)).toBe('ENOENT')
    expect(getErrnoPath(enoent)).toBe('/tmp/missing')
    expect(isENOENT(enoent)).toBe(true)
    expect(isFsInaccessible(enoent)).toBe(true)
    expect(isFsInaccessible(eacces)).toBe(true)
    expect(isFsInaccessible(new Error('other'))).toBe(false)
  })

  test('shortens long stacks and classifies axios-like errors', () => {
    const err = new Error('failed')
    err.stack = [
      'Error: failed',
      '    at one (/tmp/a.ts:1:1)',
      '    at two (/tmp/b.ts:2:1)',
      '    at three (/tmp/c.ts:3:1)',
      '    at four (/tmp/d.ts:4:1)',
      '    at five (/tmp/e.ts:5:1)',
      '    at six (/tmp/f.ts:6:1)',
    ].join('\n')

    expect(shortErrorStack(err, 3)).toBe([
      'Error: failed',
      '    at one (/tmp/a.ts:1:1)',
      '    at two (/tmp/b.ts:2:1)',
      '    at three (/tmp/c.ts:3:1)',
    ].join('\n'))

    expect(
      classifyAxiosError(
        Object.assign(new Error('unauthorized'), {
          isAxiosError: true,
          response: { status: 401 },
        }),
      ),
    ).toEqual({
      kind: 'auth',
      status: 401,
      message: 'unauthorized',
    })
    expect(
      classifyAxiosError(
        Object.assign(new Error('timeout'), {
          isAxiosError: true,
          code: 'ECONNABORTED',
        }),
      ),
    ).toEqual({
      kind: 'timeout',
      status: undefined,
      message: 'timeout',
    })
    expect(
      classifyAxiosError(
        Object.assign(new Error('offline'), {
          isAxiosError: true,
          code: 'ENOTFOUND',
        }),
      ),
    ).toEqual({
      kind: 'network',
      status: undefined,
      message: 'offline',
    })
    expect(
      classifyAxiosError(
        Object.assign(new Error('server error'), {
          isAxiosError: true,
          response: { status: 500 },
        }),
      ),
    ).toEqual({
      kind: 'http',
      status: 500,
      message: 'server error',
    })
    expect(classifyAxiosError(new Error('plain'))).toEqual({
      kind: 'other',
      message: 'plain',
    })
  })
})
