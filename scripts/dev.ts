import { spawnSync } from 'node:child_process'
import type { BuildOutput } from 'bun'
import {
  getSourceBuildOptions,
  root,
  sourceBundle,
} from './runtime.ts'

if (typeof Bun === 'undefined') {
  process.stderr.write('Run this dev script with Bun: `bun run dev`.\n')
  process.exit(1)
}

async function buildSource(): Promise<BuildOutput> {
  const { buildOptions } = getSourceBuildOptions()
  const result = await Bun.build(buildOptions)

  if (!result.success) {
    for (const log of result.logs) {
      process.stderr.write(`${log}\n`)
    }
    process.exit(1)
  }

  return result
}

function runBundle(cliArgs: string[]): never {
  const child = spawnSync('bun', [sourceBundle, ...cliArgs], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  })

  if (child.error) {
    process.stderr.write(`${String(child.error)}\n`)
    process.exit(1)
  }

  process.exit(child.status ?? 0)
}

await buildSource()
runBundle(process.argv.slice(2))
