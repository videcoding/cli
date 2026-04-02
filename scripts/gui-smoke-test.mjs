import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import process from 'node:process'

if (typeof Bun === 'undefined') {
  process.stderr.write('Run this GUI smoke test with Bun: `bun run smoke:gui`.\n')
  process.exit(1)
}

const require = createRequire(import.meta.url)
const root = process.cwd()

const typeTextValue = 'claude_gui_smoke_314159'
const typeTextApp = 'TextEdit'
const typeTextDelayMs = 1200
const permissionWaitMs = Number.parseInt(
  process.env.GUI_PERMISSION_WAIT_MS ?? '120000',
  10,
)
const permissionPollMs = 1000

const results = []

function esmDefault(mod) {
  return mod?.default ?? mod
}

function printBlock(title, body) {
  process.stdout.write(`\n== ${title} ==\n`)
  process.stdout.write(`${body}\n`)
}

function commandResult(label, result) {
  const lines = [`exit: ${String(result.status ?? result.signal ?? 'unknown')}`]
  if ((result.stdout ?? '').trim()) {
    lines.push(result.stdout.trim())
  }
  if ((result.stderr ?? '').trim()) {
    lines.push(result.stderr.trim())
  }
  printBlock(label, lines.join('\n'))
}

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

function runOrThrow(command, args, label) {
  const result = run(command, args)
  commandResult(label, result)
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${String(result.status)}`)
  }
  return result
}

function normalizeAppName(appName) {
  return appName.trim().replace(/\.app$/i, '')
}

async function prepareTypingTarget(appName) {
  const normalized = normalizeAppName(appName)
  if (normalized.length === 0) {
    return
  }

  runOrThrow('open', ['-a', normalized], `activate-app: open -a ${normalized}`)
  await Bun.sleep(typeTextDelayMs)

  if (normalized === 'TextEdit') {
    runOrThrow(
      'osascript',
      [
        '-e',
        'tell application "TextEdit" to activate',
        '-e',
        'tell application "TextEdit" to make new document',
        '-e',
        'tell application "TextEdit" to activate',
      ],
      'prepare-textedit-document',
    )
    await Bun.sleep(typeTextDelayMs)
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function truthyJson(value) {
  return JSON.stringify(value, null, 2)
}

function errorDetail(error) {
  return error instanceof Error ? error.message : String(error)
}

function readTextEditDocumentText() {
  const result = run('osascript', [
    '-e',
    'tell application "TextEdit" to get text of front document',
  ])
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(
      `read-textedit-document failed with exit code ${String(result.status)}`,
    )
  }
  return String(result.stdout ?? '').replace(/\r?\n$/, '')
}

function writeTextEditDocumentText(text) {
  const result = run('osascript', [
    '-e',
    'on run argv',
    '-e',
    'tell application "TextEdit" to set text of front document to item 1 of argv',
    '-e',
    'end run',
    text,
  ])
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(
      `write-textedit-document failed with exit code ${String(result.status)}`,
    )
  }
}

async function test(name, fn, options = {}) {
  const optional = options.optional === true
  try {
    const detail = await fn()
    results.push({ name, ok: true, optional, detail })
    printBlock(
      `${name}: PASS`,
      typeof detail === 'string' ? detail : truthyJson(detail),
    )
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    results.push({ name, ok: false, optional, detail })
    printBlock(`${name}: ${optional ? 'WARN' : 'FAIL'}`, detail)
  }
}

async function withTimeout(label, promise, timeoutMs = 15000) {
  let timeoutId
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`))
        }, timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timeoutId)
  }
}

function permissionState(cu) {
  return {
    accessibility: cu.tcc.checkAccessibility(),
    screenRecording: cu.tcc.checkScreenRecording(),
    displays: cu.display.listAll(),
  }
}

async function waitForGrant(check, timeoutMs) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (check()) {
      return true
    }
    await Bun.sleep(permissionPollMs)
  }
  return check()
}

async function runPermissionPreflight(cu) {
  const before = permissionState(cu)
  printBlock('before', truthyJson(before))

  const sequence = []

  if (!before.accessibility) {
    printBlock(
      'request-accessibility',
      truthyJson({
        permission: 'Accessibility',
        note: 'Waiting for Accessibility to be granted before continuing to the next permission.',
      }),
    )
    let requestError
    try {
      cu.tcc.requestAccessibility?.()
    } catch (error) {
      requestError = errorDetail(error)
    }
    const granted = requestError
      ? cu.tcc.checkAccessibility()
      : await waitForGrant(
          () => cu.tcc.checkAccessibility(),
          permissionWaitMs,
        )
    sequence.push({
      permission: 'Accessibility',
      granted,
      timedOut: !granted && !requestError,
      ...(requestError && { requestError }),
    })
  }

  const afterAccessibility = permissionState(cu)

  if (!afterAccessibility.screenRecording) {
    printBlock(
      'request-screen-recording',
      truthyJson({
        permission: 'Screen Recording',
        note: 'Accessibility step has completed. Requesting Screen Recording now.',
      }),
    )
    let requestError
    try {
      cu.tcc.requestScreenRecording?.()
    } catch (error) {
      requestError = errorDetail(error)
    }
    const granted = requestError
      ? cu.tcc.checkScreenRecording()
      : await waitForGrant(
          () => cu.tcc.checkScreenRecording(),
          permissionWaitMs,
        )
    sequence.push({
      permission: 'Screen Recording',
      granted,
      timedOut: !granted && !requestError,
      ...(requestError && { requestError }),
    })
  }

  const after = permissionState(cu)
  printBlock('sequence', truthyJson(sequence))
  printBlock('after', truthyJson(after))

  const granted = after.accessibility && after.screenRecording
  if (!granted) {
    const missing = []
    if (!after.accessibility) missing.push('Accessibility')
    if (!after.screenRecording) missing.push('Screen Recording')
    printBlock(
      'result',
      truthyJson({
        granted: false,
        missing,
        sequence,
        note: 'Permission flow ran in one execution. If Screen Recording was newly enabled, restart the terminal app once. If a permission still shows missing, grant it in System Settings and rerun the same command.',
      }),
    )
    return { granted: false, state: after, sequence }
  }

  printBlock(
    'result',
    truthyJson({ granted: true, note: 'All GUI permissions are ready.' }),
  )
  return { granted: true, state: after, sequence }
}

async function main() {
  if (process.platform !== 'darwin') {
    throw new Error('GUI smoke test is only supported on macOS.')
  }

  runOrThrow('bun', ['run', 'build'], 'build: bun run build')

  const cu = esmDefault(require('../packages/computer-use/src/index.js'))
  const permissionPreflight = await runPermissionPreflight(cu)

  if (!permissionPreflight.granted) {
    process.stdout.write(
      '\nGUI permission preflight did not complete. Grant any missing permissions, restart the terminal once if Screen Recording was newly enabled, then rerun `bun run smoke:gui`.\n',
    )
    process.exit(1)
  }

  const input = esmDefault(require('../packages/computer-use-input/src/index.js'))
  const { createCliExecutor } = await import('../src/utils/computerUse/executor.ts')

  const executor = createCliExecutor({
    getMouseAnimationEnabled: () => false,
    getHideBeforeActionEnabled: () => false,
  })

  let frontmost = null

  await test('permissions', async () => {
    const detail = {
      ...permissionState(cu),
      requested: permissionPreflight.sequence.map(step => step.permission),
      note:
        permissionPreflight.sequence.length > 0
          ? 'Permissions were preflighted before GUI actions ran.'
          : 'Permissions were already granted before the GUI smoke run.',
    }
    assert(detail.accessibility === true, 'Accessibility permission is not granted.')
    assert(
      detail.screenRecording === true,
      'Screen Recording permission is not granted.',
    )
    assert(detail.displays.length > 0, 'No displays were reported by native capture.')
    return detail
  })

  await test('frontmost-and-mouse', async () => {
    const detail = {
      mouse: input.mouseLocation(),
      frontmost: input.getFrontmostAppInfo(),
    }
    frontmost = detail.frontmost
    assert(detail.mouse.x !== undefined && detail.mouse.y !== undefined, 'Mouse location is missing.')
    assert(detail.frontmost !== null, 'Frontmost app info is null.')
    return detail
  })

  await test('native-screenshot', async () => {
    const capture = await withTimeout(
      'native-screenshot',
      cu.resolvePrepareCapture([], 'host', 0.75, 100, 100, 1, false, false),
    )
    const detail = {
      width: capture.width,
      height: capture.height,
      hasImage: Boolean(capture.base64),
      error: capture.captureError ?? null,
    }
    assert(detail.error === null, `Screenshot error: ${detail.error}`)
    assert(detail.hasImage === true, 'Native screenshot did not return image data.')
    assert(detail.width > 0 && detail.height > 0, 'Native screenshot returned invalid dimensions.')
    return detail
  })

  await test('installed-apps', async () => {
    const apps = await withTimeout('installed-apps', executor.listInstalledApps())
    const detail = { count: apps.length, first: apps[0] ?? null }
    assert(apps.length > 0, 'Installed apps list is empty.')
    return detail
  })

  await test('executor-screenshot', async () => {
    const allowedBundleIds = frontmost?.bundleId
      ? [frontmost.bundleId]
      : ['com.apple.finder']
    const shot = await withTimeout(
      'executor-screenshot',
      executor.screenshot({ allowedBundleIds }),
    )
    const detail = {
      width: shot.width,
      height: shot.height,
      hasImage: Boolean(shot.base64),
      allowedBundleIds,
    }
    assert(detail.hasImage === true, 'Executor screenshot did not return image data.')
    return detail
  })

  await test('mouse-move', async () => {
    const before = input.mouseLocation()
    const target = { x: before.x + 20, y: before.y + 20 }
    input.moveMouse(target.x, target.y)
    await Bun.sleep(100)
    const moved = input.mouseLocation()
    input.moveMouse(before.x, before.y)
    await Bun.sleep(100)
    const restored = input.mouseLocation()
    assert(
      moved.x !== before.x || moved.y !== before.y,
      'Mouse location did not change after moveMouse().',
    )
    return { before, moved, restored }
  })

  await test('key-press-release', async () => {
    input.key('shift', 'press')
    input.key('shift', 'release')
    return { ok: true }
  })

  await test('type-text', async () => {
    await prepareTypingTarget(typeTextApp)
    const before = input.getFrontmostAppInfo()
    assert(before !== null, 'No frontmost app detected before typing.')
    writeTextEditDocumentText(typeTextValue)
    await Bun.sleep(100)
    const actual = readTextEditDocumentText()
    assert(
      actual === typeTextValue,
      `Typed text mismatch. Expected ${JSON.stringify(typeTextValue)}, received ${JSON.stringify(actual)}.`,
    )
    return {
      typed: typeTextValue,
      actual,
      targetApp: typeTextApp,
      frontmostBeforeTyping: before,
      note:
        typeTextApp.trim().length > 0
          ? 'Text was inserted directly into the requested app document.'
          : 'Text was inserted directly into the current focused app document.',
    }
  })

  const failed = results.filter(result => !result.ok && !result.optional)
  const warned = results.filter(result => !result.ok && result.optional)
  const passed = results.filter(result => result.ok)

  printBlock(
    'summary',
    truthyJson({
      passed: passed.map(result => result.name),
      warnings: warned.map(result => result.name),
      failed: failed.map(result => result.name),
    }),
  )

  if (failed.length > 0) {
    process.exit(1)
  }
}

main().catch(error => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exit(1)
})
