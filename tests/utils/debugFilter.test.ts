import { describe, expect, test } from 'bun:test'
import {
  extractDebugCategories,
  parseDebugFilter,
  shouldShowDebugCategories,
  shouldShowDebugMessage,
} from '../../src/utils/debugFilter.ts'

describe('debugFilter', () => {
  test('parses inclusive, exclusive, and invalid filter strings', () => {
    expect(parseDebugFilter()).toBeNull()
    expect(parseDebugFilter('   ')).toBeNull()
    expect(parseDebugFilter('api, hooks')).toEqual({
      include: ['api', 'hooks'],
      exclude: [],
      isExclusive: false,
    })
    expect(parseDebugFilter('!1p,!file')).toEqual({
      include: [],
      exclude: ['1p', 'file'],
      isExclusive: true,
    })
    expect(parseDebugFilter('api,!file')).toBeNull()
  })

  test('extracts categories from common debug message formats', () => {
    expect(extractDebugCategories('MCP server "GitHub": connected')).toEqual([
      'mcp',
      'github',
    ])
    expect(
      extractDebugCategories('[ANT-ONLY] 1P event: tengu_timer fired'),
    ).toEqual(['ant-only', '1p'])
    expect(
      extractDebugCategories('AutoUpdaterWrapper: Installation type: development'),
    ).toEqual(['autoupdaterwrapper', 'installation'])
    expect(extractDebugCategories('plain message with no categories')).toEqual([])
  })

  test('applies inclusive and exclusive category matching rules', () => {
    expect(
      shouldShowDebugCategories(
        ['api', 'hooks'],
        parseDebugFilter('api,files'),
      ),
    ).toBe(true)
    expect(
      shouldShowDebugCategories(['mcp', 'github'], parseDebugFilter('!github')),
    ).toBe(false)
    expect(
      shouldShowDebugCategories([], parseDebugFilter('api,files')),
    ).toBe(false)
    expect(
      shouldShowDebugCategories([], parseDebugFilter('!api,!files')),
    ).toBe(false)
  })

  test('filters messages by extracting categories only when a filter is present', () => {
    expect(shouldShowDebugMessage('plain message', null)).toBe(true)
    expect(
      shouldShowDebugMessage('MCP server "GitHub": connected', parseDebugFilter('mcp')),
    ).toBe(true)
    expect(
      shouldShowDebugMessage(
        'AutoUpdaterWrapper: Installation type: development',
        parseDebugFilter('!installation'),
      ),
    ).toBe(false)
  })
})
