import { describe, expect, test } from 'bun:test'
import { pkg, runCli } from './cliTestUtils.ts'

describe('cli entrypoint', () => {
  test('prints the version for all supported short-circuit flags', () => {
    for (const args of [['--version'], ['-v'], ['-V']]) {
      const result = runCli(args)

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe(`${pkg.version} (Claude Code)`)
      expect(result.stderr).toBe('')
    }
  })
})
