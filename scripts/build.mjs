import { spawnSync } from 'node:child_process'
import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

if (typeof Bun === 'undefined') {
  process.stderr.write('Run this build script with Bun: `bun run build`.\n')
  process.exit(1)
}

const root = process.cwd()
const distDir = join(root, 'dist')
const sourceOutDir = join(distDir, 'src-build')
const sourceEntrypoint = 'src/entrypoints/cli.tsx'
const sourceBundle = join(sourceOutDir, 'cli.js')
const sourceErrorLog = join(distDir, 'source-build-error.log')
const binaryOut = join(distDir, 'claude')

rmSync(distDir, { recursive: true, force: true })
mkdirSync(distDir, { recursive: true })

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: 'pipe',
  })

  return {
    ...result,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function printOutput(result) {
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
}

function fail(message, result) {
  if (message) {
    process.stderr.write(`${message}\n`)
  }
  if (result) {
    printOutput(result)
  }
  process.exit(result?.status ?? 1)
}

function formatBuildLog(log) {
  const level = log.level ? `[${String(log.level).toUpperCase()}] ` : ''
  const location = log.position
    ? `${log.position.file}:${log.position.line}:${log.position.column}\n`
    : ''
  const message = typeof log.message === 'string' ? log.message : String(log)
  return `${level}${location}${message}`.trim()
}

function writeSourceLog(message) {
  writeFileSync(sourceErrorLog, `${message.trim()}\n`)
}


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

async function buildFromSource(pkg) {
  const macroValues = getMacroValues(pkg)
  const sourceBuild = await Bun.build({
    entrypoints: [sourceEntrypoint],
    outdir: sourceOutDir,
    target: 'node',
    format: 'esm',
    banner: getMacroBanner(macroValues),
    define: {
      'process.env.USER_TYPE': JSON.stringify('external'),
    },
    features: ['BUDDY'],
  })

  if (!sourceBuild.success) {
    const buildErrors = sourceBuild.logs.map(formatBuildLog).join('\n\n')
    writeSourceLog(
      [
        'Source build failed.',
        '',
        '$ bun build src/entrypoints/cli.tsx --outdir dist/src-build --target node',
        '',
        buildErrors,
      ]
        .filter(Boolean)
        .join('\n'),
    )
    process.stderr.write(readFileSync(sourceErrorLog, 'utf8'))
    return false
  }

  const compiled = run('bun', [
    'build',
    sourceBundle,
    '--compile',
    '--outfile',
    binaryOut,
  ])

  if (compiled.status !== 0) {
    writeSourceLog(
      [
        'Source bundle built, but binary compilation failed.',
        '',
        `$ bun build ${sourceBundle} --compile --outfile ${binaryOut}`,
        '',
        compiled.stdout,
        compiled.stderr,
      ]
        .filter(Boolean)
        .join('\n'),
    )
    process.stderr.write(readFileSync(sourceErrorLog, 'utf8'))
    return false
  }

  printOutput(compiled)

  const verify = run(binaryOut, ['--version'])
  if (verify.status !== 0 || !verify.stdout.includes(`${pkg.version} (Claude Code)`)) {
    writeSourceLog(
      [
        'Source binary built, but runtime verification failed.',
        '',
        `$ ${binaryOut} --version`,
        '',
        verify.stdout,
        verify.stderr,
      ]
        .filter(Boolean)
        .join('\n'),
    )
    process.stderr.write(readFileSync(sourceErrorLog, 'utf8'))
    return false
  }

  writeSourceLog(
    [
      'Source build succeeded.',
      '',
      `$ ${binaryOut} --version`,
      verify.stdout.trim(),
      '',
      `Source bundle: ${sourceBundle}`,
      `Binary: ${binaryOut}`,
      'Package runtime: JavaScript-first implementations',
    ]
      .filter(Boolean)
      .join('\n'),
  )

  process.stdout.write(`\nBuilt from src entrypoint: ${binaryOut}\n`)
  return true
}

const pkg = getPackageJson()
const builtFromSource = await buildFromSource(pkg)

if (!builtFromSource) {
  fail(`Source build failed. See ${sourceErrorLog} for details.`)
}
