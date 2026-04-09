import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import type { SpawnSyncReturns } from 'node:child_process'

if (typeof Bun === 'undefined') {
  process.stderr.write('Run this GUI smoke test with Bun: `bun run smoke:gui`.\n')
  process.exit(1)
}

const root = process.cwd()
type RunOptions = {
  env?: NodeJS.ProcessEnv
}

type CommandResult = SpawnSyncReturns<string> & {
  stdout: string
  stderr: string
}

type PermissionName = 'Accessibility' | 'Screen Recording'
type PermissionState = 'granted' | 'missing'
type PermissionStatus = Partial<Record<PermissionName, PermissionState>>
type JsonRecord = Record<string, unknown>

function run(
  command: string,
  args: string[],
  options: RunOptions = {},
): CommandResult {
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

function runInherit(
  command: string,
  args: string[],
  options: RunOptions = {},
): void {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      ...options.env,
    },
  })

  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${String(result.status)}`)
  }
}

function printResult(label: string, result: CommandResult): void {
  process.stdout.write(`\n== ${label} ==\n`)
  process.stdout.write(`exit: ${String(result.status ?? result.signal ?? 'unknown')}\n`)
  if (result.stdout.trim()) {
    process.stdout.write(`${result.stdout.trim()}\n`)
  }
  if (result.stderr.trim()) {
    process.stdout.write(`${result.stderr.trim()}\n`)
  }
}

function expectOk(
  label: string,
  command: string,
  args: string[],
  validate?: (result: CommandResult) => boolean,
  options: RunOptions = {},
): CommandResult {
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
  return result
}

function parseJsonOutput<T extends JsonRecord>(
  label: string,
  command: string,
  args: string[],
  options: RunOptions = {},
): T {
  const result = expectOk(label, command, args, () => true, options)
  const text = result.stdout.trim()
  if (!text) {
    throw new Error(`${label} produced no stdout`)
  }
  try {
    return JSON.parse(text) as T
  } catch (error) {
    throw new Error(`${label} did not produce valid JSON: ${String(error)}`)
  }
}

function parseBooleanEnv(name: string, fallback = false): boolean {
  const raw = process.env[name]
  if (!raw) return fallback
  return raw === '1' || raw.toLowerCase() === 'true'
}

function delay(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} was missing or empty`)
  }
  return value
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error(`${label} was missing or invalid`)
  }
  return value
}

function parsePermissionStatus(lines: string[]): PermissionStatus {
  const status: PermissionStatus = {}
  for (const line of lines) {
    const match = line.match(/^\s*(Accessibility|Screen Recording):\s*(granted|missing)\s*$/i)
    if (!match) continue
    const name = match[1] as PermissionName
    const state = match[2].toLowerCase() as PermissionState
    status[name] = state
  }
  return status
}

function preflightGuiPermissions(): {
  lines: string[]
  status: PermissionStatus
} {
  const script = [
    'tell application "System Events"',
    'set uiEnabled to UI elements enabled',
    'end tell',
    'return "Accessibility: " & (uiEnabled as string)',
  ].join('\n')

  const accessibility = run('osascript', ['-e', script])
  const screenRecordingProbe = run('screencapture', ['-x', join(tmpdir(), '.claude-gui-smoke-permission-check.png')])

  const lines = []
  if (accessibility.status === 0) {
    lines.push(
      `Accessibility: ${accessibility.stdout.toLowerCase().includes('true') ? 'granted' : 'missing'}`,
    )
  } else {
    lines.push('Accessibility: missing')
  }

  if (screenRecordingProbe.status === 0) {
    lines.push('Screen Recording: granted')
  } else {
    lines.push('Screen Recording: missing')
  }

  return {
    lines,
    status: parsePermissionStatus(lines),
  }
}

function ensureMacOs(): void {
  if (process.platform !== 'darwin') {
    throw new Error('GUI smoke test is only supported on macOS.')
  }
}

function checkPermissionsOrThrow(): void {
  const preflight = preflightGuiPermissions()
  for (const line of preflight.lines) {
    process.stdout.write(`${line}\n`)
  }

  const accessibility = preflight.status['Accessibility']
  const screenRecording = preflight.status['Screen Recording']
  const granted =
    accessibility === 'granted' && screenRecording === 'granted'

  if (!granted) {
    throw new Error(
      '\nGUI permission preflight did not complete. Grant any missing permissions, restart the terminal once if Screen Recording was newly enabled, then rerun `bun run smoke:gui`.\n',
    )
  }

  process.stdout.write(
    accessibility === 'granted' && screenRecording === 'granted'
      ? 'Permissions were already granted before the GUI smoke run.\n'
      : '',
  )
}

function activateTextEdit(): void {
  runInherit('open', ['-a', 'TextEdit'])
  for (let i = 0; i < 20; i++) {
    const frontmost = run('osascript', [
      '-e',
      'tell application "System Events" to get name of first application process whose frontmost is true',
    ])
    if (frontmost.status === 0 && frontmost.stdout.trim() === 'TextEdit') {
      return
    }
    delay(250)
  }
  throw new Error('TextEdit did not become frontmost in time.')
}

function buildExecutorScript(lines: string[]): string {
  return [
    `const root = ${JSON.stringify(root)};`,
    `process.chdir(root);`,
    ...lines,
  ].join('\n')
}

function runExecutor<T extends JsonRecord>(
  label: string,
  bodyLines: string[],
): T {
  const script = buildExecutorScript(bodyLines)
  return parseJsonOutput<T>(label, 'bun', ['-e', script], {
    env: {
      CLAUDE_CODE_TEST_STDOUT_JSON: '1',
    },
  })
}

function assertScreenshotPayload(payload: JsonRecord, label: string): void {
  const width = requireNumber(payload.width, `${label}.width`)
  const height = requireNumber(payload.height, `${label}.height`)
  const byteLength = requireNumber(payload.byteLength, `${label}.byteLength`)
  if (width <= 0 || height <= 0 || byteLength <= 0) {
    throw new Error(`${label} reported an empty screenshot`)
  }
}

function main(): void {
  ensureMacOs()

  expectOk('build', 'bun', ['run', 'build'], result =>
    result.stdout.includes('Built from src entrypoint'),
  )

  process.stdout.write('\n== GUI permission preflight ==\n')
  checkPermissionsOrThrow()

  const frontmost = run('osascript', [
    '-e',
    'tell application "System Events" to get name of first application process whose frontmost is true',
  ])
  printResult('frontmost-app', frontmost)
  if (frontmost.status !== 0 || !frontmost.stdout.trim()) {
    throw new Error('Unable to determine the frontmost application.')
  }

  const mousePosition = runExecutor<{ x: number; y: number }>(
    'mouse-position',
    [
      "import input from './packages/computer-use-input/src/index.js';",
      "console.log(JSON.stringify(input.mouseLocation()));",
    ],
  )
  requireNumber(mousePosition.x, 'mouse-position.x')
  requireNumber(mousePosition.y, 'mouse-position.y')

  const packageScreenshot = runExecutor<{
    width: number
    height: number
    byteLength: number
  }>(
    'package-screenshot',
    [
      "import cu from './packages/computer-use/src/index.js';",
      'const shot = await cu.screenshot.captureExcluding([]);',
      'console.log(JSON.stringify({ width: shot.width, height: shot.height, byteLength: shot.data.length }));',
    ],
  )
  assertScreenshotPayload(packageScreenshot, 'package-screenshot')

  const executorScreenshot = runExecutor<{
    width: number
    height: number
    byteLength: number
  }>(
    'executor-screenshot',
    [
      "import { createExecutor } from './src/utils/computerUse/executor.ts';",
      'const executor = createExecutor();',
      'const shot = await executor.captureScreenshot();',
      'console.log(JSON.stringify({ width: shot.width, height: shot.height, byteLength: shot.data.length }));',
    ],
  )
  assertScreenshotPayload(executorScreenshot, 'executor-screenshot')

  const initialMouse = {
    x: requireNumber(mousePosition.x, 'initialMouse.x'),
    y: requireNumber(mousePosition.y, 'initialMouse.y'),
  }

  runExecutor(
    'mouse-move',
    [
      "import input from './packages/computer-use-input/src/index.js';",
      `input.moveMouse(${initialMouse.x + 5}, ${initialMouse.y + 5});`,
      'const pos = input.mouseLocation();',
      'console.log(JSON.stringify(pos));',
    ],
  )

  runExecutor(
    'mouse-restore',
    [
      "import input from './packages/computer-use-input/src/index.js';",
      `input.moveMouse(${initialMouse.x}, ${initialMouse.y});`,
      'const pos = input.mouseLocation();',
      'console.log(JSON.stringify(pos));',
    ],
  )

  runExecutor(
    'key-press-release',
    [
      "import input from './packages/computer-use-input/src/index.js';",
      "input.key('escape', 'down');",
      "input.key('escape', 'up');",
      "console.log(JSON.stringify({ ok: true }));",
    ],
  )

  activateTextEdit()

  const uniqueText = `Claude GUI smoke ${Date.now()}`
  runExecutor(
    'textedit-insert',
    [
      "import input from './packages/computer-use-input/src/index.js';",
      `input.typeText(${JSON.stringify(uniqueText)});`,
      "console.log(JSON.stringify({ ok: true }));",
    ],
  )

  delay(500)

  const verification = run('osascript', [
    '-e',
    'tell application "TextEdit" to get text of front document',
  ])
  printResult('textedit-verify', verification)
  if (verification.status !== 0 || !verification.stdout.includes(uniqueText)) {
    throw new Error('TextEdit content verification failed.')
  }

  process.stdout.write('\nGUI smoke test completed successfully.\n')
}

main()
