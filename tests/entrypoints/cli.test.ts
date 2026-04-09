import { describe, expect, test } from 'bun:test'

function runSourceCli(args: string[]) {
  const result = Bun.spawnSync({
    cmd: [
      process.execPath,
      '--feature',
      'BUDDY',
      '--preload',
      './tests/preload.ts',
      './src/entrypoints/cli.tsx',
      ...args,
    ],
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      USER_TYPE: 'external',
    },
    stdin: new Uint8Array(0),
    stdout: 'pipe',
    stderr: 'pipe',
  })

  return {
    exitCode: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  }
}

describe('cli entrypoint source tests', () => {
  test('prints the version for all supported short-circuit flags from the source entrypoint', () => {
    for (const args of [['--version'], ['-v'], ['-V']]) {
      const result = runSourceCli(args)

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe(`${MACRO.VERSION} (Claude Code)`)
      expect(result.stderr).toBe('')
    }
  })
})
