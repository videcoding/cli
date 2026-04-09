import { spawnSync } from 'node:child_process'
import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import {
  binaryOut,
  distDir,
  getSourceBuildOptions,
  root,
  sourceBundle,
  sourceBuildLog,
} from './runtime.mjs'

if (typeof Bun === 'undefined') {
  process.stderr.write('Run this build script with Bun: `bun run build`.\n')
  process.exit(1)
}

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
  writeFileSync(sourceBuildLog, `${message.trim()}\n`)
}

async function buildFromSource(pkg) {
  const { buildOptions } = getSourceBuildOptions()
  const sourceBuild = await Bun.build(buildOptions)

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
    process.stderr.write(readFileSync(sourceBuildLog, 'utf8'))
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
    process.stderr.write(readFileSync(sourceBuildLog, 'utf8'))
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
    process.stderr.write(readFileSync(sourceBuildLog, 'utf8'))
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

const { pkg } = getSourceBuildOptions()
const builtFromSource = await buildFromSource(pkg)

if (!builtFromSource) {
  fail(`Source build failed. See ${sourceBuildLog} for details.`)
}
