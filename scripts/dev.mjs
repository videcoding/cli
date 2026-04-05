import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

if (typeof Bun === 'undefined') {
  process.stderr.write('Run this dev script with Bun: `bun run dev`.\n')
  process.exit(1)
}

const root = process.cwd()
const distDir = join(root, 'dist')
const sourceOutDir = join(distDir, 'src-build')
const sourceEntrypoint = 'src/entrypoints/cli.tsx'
const sourceBundle = join(sourceOutDir, 'cli.js')

function getPackageJson() {
  return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
}

function getMacroValues(pkg) {
  const feedbackChannel =
    process.env.CLAUDE_CODE_FEEDBACK_CHANNEL ||
    pkg.bugs?.url ||
    'https://github.com/anthropics/claude-code/issues'
  const packageUrl =
    process.env.CLAUDE_CODE_PACKAGE_URL ||
    pkg.name ||
    '@videcoding/cli'

  return {
    ISSUES_EXPLAINER:
      process.env.CLAUDE_CODE_ISSUES_EXPLAINER ||
      `report the issue at ${feedbackChannel}`,
    PACKAGE_URL: packageUrl,
    README_URL:
      process.env.CLAUDE_CODE_README_URL ||
      'https://code.claude.com/docs/en/overview',
    VERSION: pkg.version || '0.0.0',
    FEEDBACK_CHANNEL: feedbackChannel,
    BUILD_TIME: process.env.CLAUDE_CODE_BUILD_TIME || new Date().toISOString(),
    NATIVE_PACKAGE_URL:
      process.env.CLAUDE_CODE_NATIVE_PACKAGE_URL || packageUrl,
    VERSION_CHANGELOG: process.env.CLAUDE_CODE_VERSION_CHANGELOG || '',
  }
}

function getMacroBanner(macroValues) {
  return `const MACRO = Object.freeze(${JSON.stringify(macroValues)});\n`
}

function parseArgs(argv) {
  const args = [...argv]
  let watch = false
  let watchOnly = false

  while (args[0]?.startsWith('--')) {
    const flag = args.shift()
    if (flag === '--watch') {
      watch = true
      continue
    }
    if (flag === '--watch-only') {
      watch = true
      watchOnly = true
      continue
    }
    args.unshift(flag)
    break
  }

  return { watch, watchOnly, cliArgs: args }
}

async function buildSource({ watch }) {
  const pkg = getPackageJson()
  const macroValues = getMacroValues(pkg)
  const result = await Bun.build({
    entrypoints: [sourceEntrypoint],
    outdir: sourceOutDir,
    target: 'node',
    format: 'esm',
    banner: getMacroBanner(macroValues),
    define: {
      'process.env.USER_TYPE': JSON.stringify('external'),
    },
    features: ['BUDDY'],
    ...(watch ? { watch: true } : {}),
  })

  if (!result.success) {
    for (const log of result.logs) {
      process.stderr.write(`${log}\n`)
    }
    process.exit(1)
  }

  return result
}

function runBundle(cliArgs) {
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

const { watch, watchOnly, cliArgs } = parseArgs(process.argv.slice(2))
await buildSource({ watch })

if (watchOnly) {
  process.stdout.write(`Watching source build: ${sourceBundle}\n`)
  await new Promise(() => {})
}

runBundle(cliArgs)
