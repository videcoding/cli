import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import {
  addSlowOperation,
  getLastAPIRequest,
  getLastAPIRequestMessages,
  getSlowOperations,
  resetStateForTests,
  setLastAPIRequest,
  setLastAPIRequestMessages,
} from '../../src/bootstrap/state.ts'

const originalEnv = { ...process.env }

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

beforeEach(() => {
  restoreEnv()
  resetStateForTests()
})

afterEach(() => {
  restoreEnv()
  resetStateForTests()
})

describe('bootstrap state', () => {
  test('stores and clears the last API request payloads', () => {
    const request = {
      model: 'claude-sonnet-4-6',
      max_tokens: 256,
    } as never
    const messages = [{ role: 'user', content: 'Hello' }] as never

    expect(getLastAPIRequest()).toBeNull()
    expect(getLastAPIRequestMessages()).toBeNull()

    setLastAPIRequest(request)
    setLastAPIRequestMessages(messages)

    expect(getLastAPIRequest()).toEqual(request)
    expect(getLastAPIRequestMessages()).toEqual(messages)

    resetStateForTests()
    expect(getLastAPIRequest()).toBeNull()
    expect(getLastAPIRequestMessages()).toBeNull()
  })

  test('tracks slow operations only for ant users, trims old entries, and expires them on read', () => {
    process.env.USER_TYPE = 'ant'

    const dateNowSpy = spyOn(Date, 'now')
    dateNowSpy.mockReturnValue(1_000)
    addSlowOperation('fs.readFile', 10)

    expect(getSlowOperations()).toHaveLength(1)

    for (let i = 0; i < 12; i++) {
      dateNowSpy.mockReturnValue(2_000 + i)
      addSlowOperation(`op-${i}`, i)
    }

    const current = getSlowOperations()
    expect(current).toHaveLength(10)
    expect(current[0]?.operation).toBe('op-2')
    expect(current.at(-1)?.operation).toBe('op-11')

    dateNowSpy.mockReturnValue(20_500)
    expect(getSlowOperations()).toEqual([])

    dateNowSpy.mockRestore()
  })

  test('ignores slow operations for external users and editor prompts', () => {
    process.env.USER_TYPE = 'external'
    addSlowOperation('fs.readFile', 10)
    expect(getSlowOperations()).toEqual([])

    process.env.USER_TYPE = 'ant'
    addSlowOperation('exec claude-prompt-tempfile', 1000)
    expect(getSlowOperations()).toEqual([])
  })
})
