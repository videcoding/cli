import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

export const root = join(import.meta.dir, '..', '..')
export const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  version: string
}

function buildEnv(overrides: Record<string, string> = {}) {
  return Object.fromEntries(
    Object.entries({
      ...process.env,
      NODE_ENV: 'production',
      USER_TYPE: 'external',
      ...overrides,
    }).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
}

function spawnCli(args: string[], env: Record<string, string>) {
  const result = Bun.spawnSync({
    cmd: [
      process.execPath,
      '--preload',
      './scripts/dev-preload.mjs',
      './src/entrypoints/cli.tsx',
      ...args,
    ],
    cwd: root,
    env,
    // Close stdin with an immediate EOF so print-mode tests do not take the
    // non-TTY "ignored stdin" path that can hang on Linux CI.
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

export function runCli(args: string[], envOverrides: Record<string, string> = {}) {
  return spawnCli(args, buildEnv(envOverrides))
}

export function runCliIsolated(
  args: string[],
  envOverrides: Record<string, string> = {},
) {
  const home = mkdtempSync(join(tmpdir(), 'videcoding-cli-test-home-'))
  try {
    return spawnCli(args, buildEnv({
      HOME: home,
      XDG_CONFIG_HOME: join(home, '.config'),
      XDG_CACHE_HOME: join(home, '.cache'),
      ...envOverrides,
    }))
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}
