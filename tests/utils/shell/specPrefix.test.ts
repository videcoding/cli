import { describe, expect, test } from 'bun:test'
import type { CommandSpec } from '../../../src/utils/bash/registry.ts'
import { buildPrefix } from '../../../src/utils/shell/specPrefix.ts'

describe('specPrefix', () => {
  test('skips global flags to find the first meaningful subcommand', async () => {
    const gitSpec: CommandSpec = {
      name: 'git',
      subcommands: [{ name: 'status' }],
      options: [{ name: '-C', args: { name: 'path' } }],
    }

    await expect(
      buildPrefix('git', ['-C', '/tmp/repo', 'status', '--short'], gitSpec),
    ).resolves.toBe('git status')
  })

  test('keeps optional subcommand arguments when the spec allows them', async () => {
    const gitSpec: CommandSpec = {
      name: 'git',
      subcommands: [
        {
          name: 'fetch',
          args: [{ name: 'remote', isOptional: true }],
        },
      ],
    }

    await expect(buildPrefix('git', ['fetch', 'origin'], gitSpec)).resolves.toBe(
      'git fetch origin',
    )
  })

  test('keeps python module prefixes but stops before inline scripts', async () => {
    const pythonModuleSpec: CommandSpec = {
      name: 'python',
      options: [{ name: '-m', args: { isModule: true } }],
    }

    await expect(
      buildPrefix('python', ['-m', 'http.server'], pythonModuleSpec),
    ).resolves.toBe('python -m http.server')
    await expect(
      buildPrefix('python', ['-c', 'print(1)'], { name: 'python' }),
    ).resolves.toBe('python')
  })

  test('stops before file and url arguments, but keeps deep subcommands', async () => {
    const curlSpec: CommandSpec = {
      name: 'curl',
      args: [{ name: 'url' }],
    }
    const dockerSpec: CommandSpec = {
      name: 'docker',
      subcommands: [
        {
          name: 'compose',
          subcommands: [{ name: 'up' }],
        },
      ],
    }

    await expect(
      buildPrefix('curl', ['https://example.com'], curlSpec),
    ).resolves.toBe('curl')
    await expect(buildPrefix('docker', ['compose', 'up'], dockerSpec)).resolves.toBe(
      'docker compose up',
    )
  })
})
