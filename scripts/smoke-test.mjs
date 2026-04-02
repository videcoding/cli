import { spawnSync } from 'node:child_process'

if (typeof Bun === 'undefined') {
  process.stderr.write('Run this smoke test with Bun: `bun run smoke`.\n')
  process.exit(1)
}

const root = process.cwd()

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: 'pipe',
    env: {
      ...process.env,
      ...options.env,
    },
  })

  return {
    ...result,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function printResult(label, result) {
  process.stdout.write(`\n== ${label} ==\n`)
  process.stdout.write(`exit: ${String(result.status ?? result.signal ?? 'unknown')}\n`)
  if (result.stdout.trim()) {
    process.stdout.write(`${result.stdout.trim()}\n`)
  }
  if (result.stderr.trim()) {
    process.stdout.write(`${result.stderr.trim()}\n`)
  }
}

function expectOk(label, command, args, validate, options) {
  const result = run(command, args, options)
  printResult(`${label}: ${[command, ...args].join(' ')}`, result)
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status}`)
  }
  if (validate && !validate(result)) {
    throw new Error(`${label} produced unexpected output`)
  }
}

function expectKnownFailure(label, command, args, acceptedExitCodes, validate, options) {
  const result = run(command, args, options)
  printResult(`${label}: ${[command, ...args].join(' ')}`, result)
  if (result.error) {
    throw result.error
  }
  if (!acceptedExitCodes.includes(result.status ?? -1)) {
    throw new Error(
      `${label} failed with unexpected exit code ${String(result.status)}`,
    )
  }
  if (validate && !validate(result)) {
    throw new Error(`${label} produced unexpected output`)
  }
}

expectOk('build', 'bun', ['run', 'build'], result =>
  result.stdout.includes('Built from src entrypoint'),
)

expectOk('version', './dist/claude', ['--version'], result =>
  result.stdout.includes('(Claude Code)'),
)

if (process.platform === 'darwin') {
  expectOk(
    'computer-use-input-js',
    'bun',
    [
      '-e',
      "import mod from './packages/computer-use-input/src/index.js'; const keys = ['moveMouse','mouseButton','mouseLocation','mouseScroll','typeText','key','keys','getFrontmostAppInfo']; if (mod.isSupported !== true || !keys.every(key => typeof mod[key] === 'function')) process.exit(1); process.stdout.write('computer-use-input-js:ok\\n')",
    ],
    result => result.stdout.includes('computer-use-input-js:ok'),
  )

  expectOk(
    'computer-use-js',
    'bun',
    [
      '-e',
      "import cu from './packages/computer-use/src/index.js'; if (!cu || typeof cu.resolvePrepareCapture !== 'function' || typeof cu.screenshot?.captureExcluding !== 'function' || typeof cu.display?.listAll !== 'function' || typeof cu.tcc?.checkAccessibility !== 'function') process.exit(1); process.stdout.write('computer-use-js:ok\\n')",
    ],
    result => result.stdout.includes('computer-use-js:ok'),
  )

  expectOk(
    'modifiers-js',
    'bun',
    [
      '-e',
      "import * as mod from './packages/modifiers-napi/src/index.ts'; if (typeof mod.getModifiers !== 'function' || typeof mod.isModifierPressed !== 'function') process.exit(1); console.log('modifiers-js:ok')",
    ],
    result => result.stdout.includes('modifiers-js:ok'),
  )

  expectOk(
    'image-processor-js',
    'bun',
    [
      '-e',
      "import { createRequire } from 'node:module'; import { getNativeModule } from './packages/image-processor-napi/src/index.ts'; const require = createRequire(import.meta.url); const sharpImported = require('sharp'); const sharp = typeof sharpImported === 'function' ? sharpImported : sharpImported.default; const input = await sharp({ create: { width: 1, height: 1, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } }).png().toBuffer(); const mod = getNativeModule(); const proc = await mod.processImage(input); const meta = await proc.metadata(); const out = await proc.resize(1, 1, { fit: 'inside', withoutEnlargement: true }).jpeg(80).toBuffer(); if (meta.width !== 1 || meta.height !== 1 || !Buffer.isBuffer(out) || out.length === 0 || typeof mod.hasClipboardImage !== 'function' || typeof mod.readClipboardImage !== 'function') process.exit(1); console.log('image-processor-js:ok')",
    ],
    result => result.stdout.includes('image-processor-js:ok'),
  )

  expectOk(
    'url-handler-js',
    'bun',
    [
      '-e',
      "process.env.CLAUDE_CODE_HANDLE_URI = 'claude-cli://open?q=hello'; import { waitForUrlEvent } from './packages/url-handler-napi/src/index.ts'; if (waitForUrlEvent(0) !== 'claude-cli://open?q=hello') process.exit(1); console.log('url-handler-js:ok')",
    ],
    result => result.stdout.includes('url-handler-js:ok'),
  )
}

expectOk('bin-launcher', 'node', ['bin/claude.js', '--version'], result =>
  result.stdout.includes('(Claude Code)'),
)

expectOk('help', './dist/claude', ['--help'], result =>
  result.stdout.includes('Usage: claude'),
)

expectKnownFailure(
  'auth-status',
  './dist/claude',
  ['auth', 'status', '--text'],
  [0, 1],
  result =>
    result.stdout.includes('Not logged in') ||
    result.stderr.includes('Not logged in') ||
    result.stdout.includes('Logged in') ||
    result.stderr.includes('Logged in'),
)

expectOk('plugin-list', './dist/claude', ['plugin', 'list'], () => true)
expectOk('mcp-list', './dist/claude', ['mcp', 'list'], () => true)
expectOk('agents', './dist/claude', ['agents'], () => true)

expectOk(
  'computer-use-mcp-server',
  'bun',
  [
    '-e',
    "import { createComputerUseMcpServerForCli } from './src/utils/computerUse/mcpServer.ts'; await createComputerUseMcpServerForCli(); console.log('computer-use-mcp:ok')",
  ],
  result => result.stdout.includes('computer-use-mcp:ok'),
)

process.stdout.write('\nSmoke test completed successfully.\n')
