import { describe, expect, test } from 'bun:test'
import {
  djb2Hash,
  hashContent,
  hashPair,
} from '../../src/utils/hash.ts'

describe('hash', () => {
  test('produces deterministic djb2 hashes', () => {
    expect(djb2Hash('')).toBe(0)
    expect(djb2Hash('abc')).toBe(96354)
    expect(djb2Hash('abc')).toBe(djb2Hash('abc'))
  })

  test('hashes content and ordered string pairs distinctly', () => {
    expect(hashContent('abc')).toBe(hashContent('abc'))
    expect(hashContent('abc')).not.toBe(hashContent('abcd'))

    expect(hashPair('ts', 'code')).toBe(hashPair('ts', 'code'))
    expect(hashPair('ts', 'code')).not.toBe(hashPair('tsc', 'ode'))
    expect(hashPair('left', 'right')).not.toBe(hashPair('right', 'left'))
  })
})
