import { describe, expect, test } from 'bun:test'
import {
  registerCleanup,
  runCleanupFunctions,
} from '../../src/utils/cleanupRegistry.ts'

describe('cleanupRegistry', () => {
  test('runs registered cleanup functions and supports unregistering', async () => {
    const calls: string[] = []
    const unregister = registerCleanup(async () => {
      calls.push('kept')
    })

    const unregisterRemoved = registerCleanup(async () => {
      calls.push('removed')
    })
    unregisterRemoved()

    await runCleanupFunctions()
    unregister()

    expect(calls).toEqual(['kept'])
  })
})
