import { describe, expect, test } from 'bun:test'
import {
  EndTruncatingAccumulator,
  capitalize,
  countCharInString,
  escapeRegExp,
  firstLineOf,
  normalizeFullWidthDigits,
  normalizeFullWidthSpace,
  plural,
  safeJoinLines,
} from '../../src/utils/stringUtils.ts'

describe('stringUtils', () => {
  test('escapes regular expression metacharacters', () => {
    expect(escapeRegExp('file?.(ts)')).toBe('file\\?\\.\\(ts\\)')
  })

  test('capitalizes only the first character', () => {
    expect(capitalize('fooBar')).toBe('FooBar')
    expect(capitalize('')).toBe('')
  })

  test('returns the correct plural form', () => {
    expect(plural(1, 'file')).toBe('file')
    expect(plural(3, 'file')).toBe('files')
    expect(plural(2, 'entry', 'entries')).toBe('entries')
  })

  test('returns the first line without splitting the whole string', () => {
    expect(firstLineOf('alpha\nbeta\ngamma')).toBe('alpha')
    expect(firstLineOf('single line')).toBe('single line')
  })

  test('counts characters in strings and buffers', () => {
    expect(countCharInString('a,b,c,d', ',')).toBe(3)
    expect(countCharInString(Buffer.from('abba'), 'b')).toBe(2)
  })

  test('normalizes full-width digits and spaces', () => {
    expect(normalizeFullWidthDigits('１２３４５')).toBe('12345')
    expect(normalizeFullWidthSpace('hello　world')).toBe('hello world')
  })

  test('joins lines safely and truncates with a marker when needed', () => {
    expect(safeJoinLines(['a', 'b', 'c'], ',')).toBe('a,b,c')
    expect(safeJoinLines(['abc', 'defghijklmnopqrstuv'], ',', 20)).toBe(
      'abc,de...[truncated]',
    )
  })

  test('truncates accumulated output from the end', () => {
    const accumulator = new EndTruncatingAccumulator(5)

    accumulator.append('abc')
    accumulator.append(Buffer.from('def'))

    expect(accumulator.length).toBe(5)
    expect(accumulator.truncated).toBe(true)
    expect(accumulator.totalBytes).toBe(6)
    expect(accumulator.toString()).toContain('abcde')
    expect(accumulator.toString()).toContain('0KB removed')

    accumulator.clear()
    expect(accumulator.length).toBe(0)
    expect(accumulator.truncated).toBe(false)
    expect(accumulator.totalBytes).toBe(0)
  })
})
