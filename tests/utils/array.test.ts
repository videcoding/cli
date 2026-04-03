import { describe, expect, test } from 'bun:test'
import { count, intersperse, uniq } from '../../src/utils/array.ts'

describe('array utils', () => {
  test('intersperse inserts separators between items only', () => {
    expect(intersperse(['a', 'b', 'c'], index => `-${index}-`)).toEqual([
      'a',
      '-1-',
      'b',
      '-2-',
      'c',
    ])
    expect(intersperse([], () => 'x')).toEqual([])
  })

  test('counts matching items and deduplicates iterables', () => {
    expect(count([0, 1, 2, 3], value => value % 2 === 1)).toBe(2)
    expect(uniq(['a', 'b', 'a', 'c', 'b'])).toEqual(['a', 'b', 'c'])
  })
})
