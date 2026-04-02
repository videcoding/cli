#!/usr/bin/env node

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const args = process.argv.slice(2)

const compiledBinary = join(root, 'dist', 'claude')
const sourceBundle = join(root, 'dist', 'src-build', 'cli.js')
const sourceEntrypoint = join(root, 'src', 'entrypoints', 'cli.tsx')
const devPreload = join(root, 'scripts', 'dev-preload.mjs')

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  })

  if (result.error) {
    process.stderr.write(`${String(result.error)}\n`)
    process.exit(1)
  }

  process.exit(result.status ?? 0)
}

if (existsSync(compiledBinary)) {
  run(compiledBinary, args)
}

if (existsSync(sourceBundle)) {
  run('bun', [sourceBundle, ...args])
}

run('bun', ['--preload', devPreload, sourceEntrypoint, ...args])
