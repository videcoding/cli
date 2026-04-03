import { describe, expect, test } from 'bun:test'
import {
  stripDisplayTags,
  stripDisplayTagsAllowEmpty,
  stripIdeContextTags,
} from '../../src/utils/displayTags.ts'

describe('displayTags', () => {
  test('strips lowercase XML-like display tags from titles', () => {
    const input = '<ide_opened_file>foo.ts</ide_opened_file>\nImplement feature'
    expect(stripDisplayTags(input)).toBe('Implement feature')
    expect(stripDisplayTagsAllowEmpty(input)).toBe('Implement feature')
  })

  test('returns the original text when stripping would produce an empty title', () => {
    const input = '<task_notification>done</task_notification>'
    expect(stripDisplayTags(input)).toBe(input)
    expect(stripDisplayTagsAllowEmpty(input)).toBe('')
  })

  test('preserves user prose containing uppercase HTML-like tokens', () => {
    const input = 'Fix the <Button> layout without touching <!DOCTYPE html>'
    expect(stripDisplayTags(input)).toBe(input)
  })

  test('strips only IDE context tags when requested', () => {
    const input =
      '<ide_opened_file>foo.ts</ide_opened_file>\n<code>keep me</code>\n<ide_selection>x</ide_selection>'
    expect(stripIdeContextTags(input)).toBe('<code>keep me</code>')
  })
})
