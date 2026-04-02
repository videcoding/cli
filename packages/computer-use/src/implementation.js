import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))
const DRIVER_PATH = join(__dirname, 'driver-jxa.js')
const FINDER_BUNDLE_ID = 'com.apple.finder'
const APP_SCAN_ROOTS = [
  '/Applications',
  '/System/Applications',
  join(homedir(), 'Applications'),
]
const APP_SCAN_MAX_DEPTH = 3
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
])

let cachedSharp = null

function sharpFactory() {
  if (cachedSharp) {
    return cachedSharp
  }
  const imported = require('sharp')
  cachedSharp = typeof imported === 'function' ? imported : imported.default
  return cachedSharp
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: options.encoding ?? 'utf8',
    stdio: 'pipe',
    ...options,
  })

  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `${command} failed`).trim())
  }
  return result
}

function runDriver(payload) {
  const result = run('/usr/bin/osascript', [
    '-l',
    'JavaScript',
    DRIVER_PATH,
    JSON.stringify(payload),
  ])
  const output = (result.stdout ?? '').trim()
  if (!output) {
    return null
  }
  return JSON.parse(output)
}

function readPngDimensions(buffer) {
  if (buffer.length < 24) return null
  if (!buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return null
  if (buffer.toString('ascii', 12, 16) !== 'IHDR') return null
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  }
}

function displayList() {
  return runDriver({ op: 'listDisplays' }) ?? []
}

function displayFor(displayId) {
  const displays = displayList()
  if (displays.length === 0) {
    throw new Error('No displays were reported by the host.')
  }

  const display =
    displayId == null
      ? displays[0]
      : displays.find(item => item.displayId === displayId) ?? displays[0]

  return {
    ...display,
    scaleFactor: display.scaleFactor ?? 1,
  }
}

function windowIntersectsDisplay(window, display) {
  const insideX =
    window.x < display.originX + display.width &&
    window.x + window.width > display.originX
  const insideY =
    window.y < display.originY + display.height &&
    window.y + window.height > display.originY
  return insideX && insideY
}

function captureScreenToBuffer(displayId) {
  const tempDir = mkdtempSync(join(tmpdir(), 'claude-code-screen-'))
  const outputPath = join(tempDir, 'capture.png')
  try {
    const args = ['-x']
    if (displayId != null) {
      args.push('-D', String(displayId))
    }
    args.push(outputPath)
    run('/usr/sbin/screencapture', args)
    return readFileSync(outputPath)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

async function toSizedJpegBase64(buffer, targetWidth, targetHeight, quality) {
  const sharp = sharpFactory()
  const pipeline = sharp(buffer)
    .resize(targetWidth, targetHeight, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: Math.max(1, Math.min(100, Math.round(quality * 100))) })
  const out = await pipeline.toBuffer()
  const meta = await sharp(out).metadata()
  return {
    base64: out.toString('base64'),
    width: meta.width ?? targetWidth,
    height: meta.height ?? targetHeight,
  }
}

async function captureRegionBase64(
  displayId,
  region,
  outWidth,
  outHeight,
  quality,
) {
  const source = captureScreenToBuffer(displayId)
  const sharp = sharpFactory()
  const display = displayFor(displayId)
  const scaleFactor = display.scaleFactor ?? 1
  const left = Math.max(
    0,
    Math.round((region.x - display.originX) * scaleFactor),
  )
  const top = Math.max(
    0,
    Math.round((region.y - display.originY) * scaleFactor),
  )
  const maxWidth = Math.max(1, Math.round(display.width * scaleFactor) - left)
  const maxHeight = Math.max(1, Math.round(display.height * scaleFactor) - top)
  const width = Math.max(
    1,
    Math.min(Math.round(region.w * scaleFactor), maxWidth),
  )
  const height = Math.max(
    1,
    Math.min(Math.round(region.h * scaleFactor), maxHeight),
  )

  const cropped = await sharp(source)
    .extract({
      left,
      top,
      width,
      height,
    })
    .png()
    .toBuffer()

  return toSizedJpegBase64(cropped, outWidth, outHeight, quality)
}

function listWindows() {
  return runDriver({ op: 'listWindows' }) ?? []
}

function listRunningApps() {
  return runDriver({ op: 'listRunningApps' }) ?? []
}

function escapeAppleScriptString(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

function plistValue(plistPath, key) {
  const result = spawnSync(
    '/usr/bin/plutil',
    ['-extract', key, 'raw', '-o', '-', plistPath],
    { encoding: 'utf8', stdio: 'pipe' },
  )
  if (result.status !== 0) {
    return null
  }
  const value = String(result.stdout ?? '').trim()
  return value || null
}

function appBaseName(appPath) {
  return appPath.split('/').pop()?.replace(/\.app$/i, '') ?? null
}

function readAppMetadata(appPath) {
  const infoPlistPath = join(appPath, 'Contents', 'Info.plist')
  if (!existsSync(infoPlistPath)) {
    return null
  }

  const bundleId = plistValue(infoPlistPath, 'CFBundleIdentifier')
  const displayName =
    plistValue(infoPlistPath, 'CFBundleDisplayName') ??
    plistValue(infoPlistPath, 'CFBundleName') ??
    appBaseName(appPath)

  if (!bundleId || !displayName) {
    return null
  }

  return {
    bundleId,
    displayName,
    path: appPath,
  }
}

function findAppIconPath(appPath) {
  const infoPlistPath = join(appPath, 'Contents', 'Info.plist')
  const resourcesPath = join(appPath, 'Contents', 'Resources')
  if (!existsSync(infoPlistPath) || !existsSync(resourcesPath)) {
    return null
  }

  const candidateNames = [
    plistValue(infoPlistPath, 'CFBundleIconFile'),
    plistValue(infoPlistPath, 'CFBundleIconName'),
    appBaseName(appPath),
  ].filter(Boolean)

  for (const candidateName of candidateNames) {
    for (const fileName of [
      candidateName,
      `${candidateName}.icns`,
      `${candidateName}.png`,
    ]) {
      const iconPath = join(resourcesPath, fileName)
      if (existsSync(iconPath)) {
        return iconPath
      }
    }
  }

  const fallback = readdirSync(resourcesPath).find(name =>
    name.toLowerCase().endsWith('.icns'),
  )
  return fallback ? join(resourcesPath, fallback) : null
}

function listSpotlightApplicationPaths() {
  const result = spawnSync(
    '/usr/bin/mdfind',
    ['kMDItemContentTypeTree == "com.apple.application-bundle"'],
    { encoding: 'utf8', stdio: 'pipe' },
  )
  if (result.status !== 0) {
    return []
  }

  return String(result.stdout ?? '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
}

function scanApplicationRoots() {
  const appPaths = []
  const queue = APP_SCAN_ROOTS.filter(root => existsSync(root)).map(root => ({
    dir: root,
    depth: APP_SCAN_MAX_DEPTH,
  }))

  while (queue.length > 0) {
    const current = queue.pop()
    if (!current) continue

    let entries
    try {
      entries = readdirSync(current.dir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const fullPath = join(current.dir, entry.name)
      if (entry.name.toLowerCase().endsWith('.app')) {
        appPaths.push(fullPath)
        continue
      }
      if (current.depth > 0) {
        queue.push({ dir: fullPath, depth: current.depth - 1 })
      }
    }
  }

  return appPaths
}

function runningAppsByBundleId() {
  return new Map(listRunningApps().map(app => [app.bundleId, app]))
}

function appsOnDisplay(displayId) {
  const display = displayFor(displayId)
  const runningByBundle = runningAppsByBundleId()
  const seen = new Set()
  const apps = []

  for (const window of listWindows()) {
    if (!window.bundleId || seen.has(window.bundleId)) continue
    if (!windowIntersectsDisplay(window, display)) continue

    const running = runningByBundle.get(window.bundleId)
    apps.push({
      bundleId: window.bundleId,
      displayName: running?.displayName ?? window.displayName ?? window.bundleId,
    })
    seen.add(window.bundleId)
  }

  return apps
}

function appsToHide(exemptBundleIds, displayId) {
  const exempt = new Set(
    (exemptBundleIds ?? []).filter(
      bundleId => typeof bundleId === 'string' && bundleId.length > 0,
    ),
  )

  return appsOnDisplay(displayId).filter(
    app => app.bundleId !== FINDER_BUNDLE_ID && !exempt.has(app.bundleId),
  )
}

function hideApp(bundleId) {
  run('/usr/bin/osascript', [
    '-e',
    `tell application id "${escapeAppleScriptString(bundleId)}" to hide`,
  ])
}

function openApp(bundleId) {
  run('/usr/bin/open', ['-b', bundleId])
  return true
}

function unhideAppInBackground(bundleId) {
  run('/usr/bin/open', ['-g', '-b', bundleId])
}

function bundleIdsToDisplayIds(bundleIds) {
  const windows = listWindows()
  const displays = displayList()

  return bundleIds.map(bundleId => {
    const ids = new Set()
    for (const window of windows) {
      if (window.bundleId !== bundleId) continue
      for (const display of displays) {
        if (windowIntersectsDisplay(window, display)) {
          ids.add(display.displayId)
        }
      }
    }
    return {
      bundleId,
      displayIds: [...ids].sort((a, b) => a - b),
    }
  })
}

function appUnderPoint(x, y) {
  const windows = listWindows()
  for (const window of windows) {
    const inside =
      x >= window.x &&
      x <= window.x + window.width &&
      y >= window.y &&
      y <= window.y + window.height
    if (inside && window.bundleId) {
      return {
        bundleId: window.bundleId,
        displayName: window.displayName ?? window.bundleId,
      }
    }
  }
  return null
}

function terminalIconDataUrl(path) {
  if (!path || !existsSync(path)) {
    return null
  }

  const iconPath = findAppIconPath(path)
  if (!iconPath) {
    return null
  }

  const tempDir = mkdtempSync(join(tmpdir(), 'claude-code-icon-'))
  const outputPath = join(tempDir, 'icon.png')
  try {
    const result = spawnSync(
      '/usr/bin/sips',
      ['-s', 'format', 'png', iconPath, '--out', outputPath],
      { encoding: 'utf8', stdio: 'pipe' },
    )
    if (result.status !== 0) {
      return null
    }
    if (!existsSync(outputPath)) {
      return null
    }
    const preview = readFileSync(outputPath)
    return `data:image/png;base64,${preview.toString('base64')}`
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

function listInstalledApps() {
  const paths = [
    ...listSpotlightApplicationPaths(),
    ...scanApplicationRoots(),
  ]

  const apps = []
  const seenBundleIds = new Set()
  const seenPaths = new Set()
  for (const appPath of paths) {
    if (seenPaths.has(appPath)) continue
    seenPaths.add(appPath)

    const metadata = readAppMetadata(appPath)
    if (!metadata || seenBundleIds.has(metadata.bundleId)) continue

    seenBundleIds.add(metadata.bundleId)
    apps.push(metadata)
  }
  return apps.sort((a, b) => a.displayName.localeCompare(b.displayName))
}

function unhideApps(bundleIds) {
  for (const bundleId of Array.isArray(bundleIds) ? bundleIds : [bundleIds]) {
    if (!bundleId) continue
    try {
      unhideAppInBackground(bundleId)
    } catch {
      // Best-effort restore.
    }
  }
  return true
}

function prepareDisplay(allowedBundleIds, hostBundleId, displayId) {
  const hidden = []
  const candidates = appsToHide(
    [...(allowedBundleIds ?? []), hostBundleId],
    displayId,
  )

  for (const app of candidates) {
    try {
      hideApp(app.bundleId)
      hidden.push(app.bundleId)
    } catch {
      // Best-effort hide.
    }
  }

  const allowed = new Set(allowedBundleIds ?? [])
  const running = runningAppsByBundleId()
  const displayLocalCandidate = appsOnDisplay(displayId).find(app =>
    allowed.has(app.bundleId),
  )
  const activated =
    displayLocalCandidate?.bundleId ??
    [...allowed].find(bundleId => running.has(bundleId))

  if (!activated) {
    return { hidden }
  }

  try {
    openApp(activated)
    return { hidden, activated }
  } catch {
    return { hidden }
  }
}

function checkAccessibility() {
  const result = spawnSync('/usr/bin/osascript', [
    '-e',
    'tell application "System Events" to return UI elements enabled',
  ], {
    encoding: 'utf8',
    stdio: 'pipe',
  })
  return result.status === 0 && String(result.stdout).trim() === 'true'
}

function requestAccessibility() {
  run('/usr/bin/open', [
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  ])
  return true
}

function checkScreenRecording() {
  const tempDir = mkdtempSync(join(tmpdir(), 'claude-screen-recording-'))
  const outputPath = join(tempDir, 'screen.png')
  try {
    const result = spawnSync('/usr/sbin/screencapture', ['-x', outputPath], {
      encoding: 'utf8',
      stdio: 'pipe',
    })
    return result.status === 0
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

function requestScreenRecording() {
  run('/usr/bin/open', [
    'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  ])
  return true
}

function getDisplaySize(displayId) {
  return displayFor(displayId)
}

function resolveTargetDisplayId(allowedBundleIds, preferredDisplayId, autoResolve) {
  const fallbackDisplayId = displayFor(preferredDisplayId).displayId
  if (!autoResolve || !allowedBundleIds || allowedBundleIds.length === 0) {
    return fallbackDisplayId
  }

  const counts = new Map()
  for (const match of bundleIdsToDisplayIds(allowedBundleIds)) {
    for (const displayId of match.displayIds) {
      counts.set(displayId, (counts.get(displayId) ?? 0) + 1)
    }
  }

  if (preferredDisplayId != null && counts.has(preferredDisplayId)) {
    return preferredDisplayId
  }

  const bestDisplayId = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1]
    return a[0] - b[0]
  })[0]?.[0]

  return bestDisplayId ?? fallbackDisplayId
}

async function captureDisplay(displayId, outWidth, outHeight, quality) {
  const display = displayFor(displayId)
  const source = captureScreenToBuffer(display.displayId)
  const sized = await toSizedJpegBase64(source, outWidth, outHeight, quality)
  return {
    ...sized,
    displayWidth: display.width,
    displayHeight: display.height,
    displayId: display.displayId,
    originX: display.originX,
    originY: display.originY,
  }
}

async function resolvePrepareCapture(
  allowedBundleIds,
  hostBundleId,
  quality,
  outWidth,
  outHeight,
  preferredDisplayId,
  autoResolve,
  doHide,
) {
  const displayId = resolveTargetDisplayId(
    allowedBundleIds ?? [],
    preferredDisplayId,
    autoResolve,
  )
  const display = displayFor(displayId)
  const hidden = doHide
    ? prepareDisplay(allowedBundleIds ?? [], hostBundleId, display.displayId).hidden
    : []

  try {
    return {
      ...(await captureDisplay(display.displayId, outWidth, outHeight, quality)),
      hidden,
    }
  } catch (error) {
    return {
      base64: '',
      width: 0,
      height: 0,
      displayWidth: display.width,
      displayHeight: display.height,
      displayId: display.displayId,
      originX: display.originX,
      originY: display.originY,
      hidden,
      captureError: error instanceof Error ? error.message : String(error),
    }
  }
}

async function captureExcluding(
  _allowedBundleIds,
  quality,
  outWidth,
  outHeight,
  displayId,
) {
  return captureDisplay(displayId, outWidth, outHeight, quality)
}

async function captureRegion(
  _allowedBundleIds,
  x,
  y,
  w,
  h,
  outWidth,
  outHeight,
  quality,
  displayId,
) {
  return captureRegionBase64(
    displayId,
    { x, y, w, h },
    outWidth,
    outHeight,
    quality,
  )
}

function drainMainRunLoop() {
  return true
}

function registerEscape() {
  return true
}

function noop() {
  return true
}

export default {
  _drainMainRunLoop: drainMainRunLoop,
  resolvePrepareCapture,
  tcc: {
    checkAccessibility,
    requestAccessibility,
    checkScreenRecording,
    requestScreenRecording,
  },
  hotkey: {
    registerEscape,
    unregister: noop,
    notifyExpectedEscape: noop,
  },
  display: {
    getSize: getDisplaySize,
    listAll: displayList,
  },
  apps: {
    prepareDisplay,
    previewHideSet: appsToHide,
    findWindowDisplays: bundleIdsToDisplayIds,
    appUnderPoint,
    listInstalled: listInstalledApps,
    iconDataUrl: terminalIconDataUrl,
    listRunning: listRunningApps,
    open: openApp,
    unhide: unhideApps,
  },
  screenshot: {
    captureExcluding,
    captureRegion,
  },
}
