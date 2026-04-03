import { describe, expect, test } from 'bun:test'
import { runCliIsolated } from './cliTestUtils.ts'

describe('cli print mode', () => {
  test('rejects invalid non-interactive format combinations early', () => {
    const cases = [
      {
        args: ['--input-format', 'stream-json'],
        error:
          'Error: --input-format=stream-json requires output-format=stream-json.',
      },
      {
        args: ['--replay-user-messages'],
        error:
          'Error: --replay-user-messages requires both --input-format=stream-json and --output-format=stream-json.',
      },
      {
        args: ['--include-partial-messages'],
        error:
          'Error: --include-partial-messages requires --print and --output-format=stream-json.',
      },
      {
        args: ['-p'],
        error:
          'Error: Input must be provided either through stdin or as a prompt argument when using --print',
      },
      {
        args: ['-p', 'hi', '--output-format', 'stream-json'],
        error:
          'Error: When using --print, --output-format=stream-json requires --verbose',
      },
    ]

    for (const { args, error } of cases) {
      const result = runCliIsolated(args)

      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr.trim()).toBe(error)
    }
  })

  test('runs local slash commands in text print mode', () => {
    const cost = runCliIsolated(['-p', '/cost'])
    const context = runCliIsolated(['-p', '/context'])

    expect(cost.exitCode).toBe(0)
    expect(cost.stdout).toContain('Total cost:')
    expect(cost.stdout).toContain('Usage:')
    expect(cost.stderr).toBe('')

    expect(context.exitCode).toBe(0)
    expect(context.stdout).toContain('## Context Usage')
    expect(context.stdout).toContain('### Estimated usage by category')
    expect(context.stderr).toBe('')
  })

  test('emits structured json results for local slash commands', () => {
    const cost = runCliIsolated(['-p', '/cost', '--output-format', 'json'])
    const context = runCliIsolated(['-p', '/context', '--output-format', 'json'])

    expect(cost.exitCode).toBe(0)
    expect(context.exitCode).toBe(0)
    expect(cost.stderr).toBe('')
    expect(context.stderr).toBe('')

    const costJson = JSON.parse(cost.stdout) as {
      type: string
      subtype: string
      is_error: boolean
      result: string
      usage: { input_tokens: number; output_tokens: number }
    }
    const contextJson = JSON.parse(context.stdout) as {
      type: string
      subtype: string
      is_error: boolean
      result: string
      usage: { input_tokens: number; output_tokens: number }
    }

    expect(costJson.type).toBe('result')
    expect(costJson.subtype).toBe('success')
    expect(costJson.is_error).toBe(false)
    expect(costJson.result).toContain('Total cost:')
    expect(costJson.usage.input_tokens).toBe(0)
    expect(costJson.usage.output_tokens).toBe(0)

    expect(contextJson.type).toBe('result')
    expect(contextJson.subtype).toBe('success')
    expect(contextJson.is_error).toBe(false)
    expect(contextJson.result).toContain('## Context Usage')
    expect(contextJson.result).toContain('### Skills')
    expect(contextJson.usage.input_tokens).toBe(0)
    expect(contextJson.usage.output_tokens).toBe(0)
  })
})
