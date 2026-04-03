import { describe, expect, test } from 'bun:test'
import {
  hasMalformedTokens,
  hasShellQuoteSingleQuoteBug,
  quote,
  tryParseShellCommand,
  tryQuoteShellArgs,
} from '../../../src/utils/bash/shellQuote.ts'

describe('shellQuote', () => {
  test('parses commands and resolves environment variables', () => {
    expect(
      tryParseShellCommand('echo $NAME', key =>
        key === 'NAME' ? 'world' : undefined,
      ),
    ).toEqual({
      success: true,
      tokens: ['echo', 'world'],
    })
  })

  test('quotes supported arguments and rejects unsupported object values', () => {
    expect(tryQuoteShellArgs(['hello world', 42, true, null])).toEqual({
      success: true,
      quoted: "'hello world' 42 true null",
    })
    expect(tryQuoteShellArgs([{ a: 1 }])).toEqual({
      success: false,
      error: 'Cannot quote argument at index 0: object values are not supported',
    })
  })

  test('falls back to JSON stringification for object arguments in quote()', () => {
    expect(quote(['echo', { a: 1 }])).toBe(`echo '{"a":1}'`)
  })

  test('detects malformed shell-quote token streams', () => {
    const unmatchedQuote = 'echo "hi;evil | cat'
    const unmatchedBracket = 'echo [unterminated'
    const ok = 'echo ok'

    const parsedUnmatchedQuote = tryParseShellCommand(unmatchedQuote)
    const parsedUnmatchedBracket = tryParseShellCommand(unmatchedBracket)
    const parsedOk = tryParseShellCommand(ok)

    expect(parsedUnmatchedQuote.success).toBe(true)
    expect(parsedUnmatchedBracket.success).toBe(true)
    expect(parsedOk.success).toBe(true)

    if (!parsedUnmatchedQuote.success || !parsedUnmatchedBracket.success || !parsedOk.success) {
      throw new Error('unreachable')
    }

    expect(hasMalformedTokens(unmatchedQuote, parsedUnmatchedQuote.tokens)).toBe(
      true,
    )
    expect(
      hasMalformedTokens(unmatchedBracket, parsedUnmatchedBracket.tokens),
    ).toBe(true)
    expect(hasMalformedTokens(ok, parsedOk.tokens)).toBe(false)
  })

  test('detects single-quote backslash patterns that shell-quote misparses', () => {
    expect(
      hasShellQuoteSingleQuoteBug(
        "git ls-remote 'safe\\\\' '--upload-pack=evil' 'repo'",
      ),
    ).toBe(true)
    expect(hasShellQuoteSingleQuoteBug("echo '\\'")).toBe(true)
    expect(hasShellQuoteSingleQuoteBug("echo '\\\\'")).toBe(false)
    expect(hasShellQuoteSingleQuoteBug("echo '\\\\' 'next'")).toBe(true)
    expect(hasShellQuoteSingleQuoteBug("git ls-remote 'safe' 'repo'")).toBe(
      false,
    )
  })
})
