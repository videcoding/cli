ObjC.import('AppKit')
ObjC.import('CoreGraphics')
ObjC.import('ApplicationServices')
ObjC.import('stdlib')

function main() {
  const argv = $.NSProcessInfo.processInfo.arguments
  if (argv.count < 5) {
    throw new Error('Expected JSON payload argument')
  }

  const payload = JSON.parse(ObjC.unwrap(argv.objectAtIndex(argv.count - 1)))
  const result = dispatch(payload)
  if (result !== undefined) {
    $.NSFileHandle.fileHandleWithStandardOutput.writeData(
      $(JSON.stringify(result)).dataUsingEncoding($.NSUTF8StringEncoding),
    )
  }
}

function dispatch(payload) {
  switch (payload.op) {
    case 'listDisplays':
      return listDisplays()
    case 'listWindows':
      return listWindows()
    case 'listRunningApps':
      return listRunningApps()
    default:
      throw new Error(`Unsupported operation: ${payload.op}`)
  }
}

function listDisplays() {
  const screens = $.NSScreen.screens.js
  const mainScreen = $.NSScreen.mainScreen
  const mainDescription = mainScreen ? mainScreen.deviceDescription : null
  const mainScreenNumber = mainDescription
    ? mainDescription.objectForKey('NSScreenNumber')
    : null
  const primaryDisplayId = mainScreenNumber
    ? Number(ObjC.unwrap(mainScreenNumber))
    : null
  return screens.map(screen => {
    const frame = screen.frame
    const description = screen.deviceDescription
    const screenNumber = description.objectForKey('NSScreenNumber')
    const displayId = Number(ObjC.unwrap(screenNumber))
    return {
      displayId,
      originX: Math.round(frame.origin.x),
      originY: Math.round(frame.origin.y),
      width: Math.round(frame.size.width),
      height: Math.round(frame.size.height),
      scaleFactor: Number(screen.backingScaleFactor) || 1,
      label: ObjC.unwrap(screen.localizedName) || null,
      isPrimary: primaryDisplayId === displayId,
    }
  })
}

function bundleIdForPid(pid) {
  if (!pid) {
    return null
  }
  const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(pid)
  if (!app) {
    return null
  }
  const bundleIdentifier = app.bundleIdentifier
  return bundleIdentifier ? ObjC.unwrap(bundleIdentifier) : null
}

function listWindows() {
  const options =
    $.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements
  const windowInfo = $.CGWindowListCopyWindowInfo(options, $.kCGNullWindowID)
  const windows = ObjC.deepUnwrap(windowInfo) || []
  $.CFRelease(windowInfo)

  return windows
    .filter(window => Number(window.kCGWindowLayer || 0) === 0)
    .map(window => {
      const bounds = window.kCGWindowBounds || {}
      const bundleId = bundleIdForPid(Number(window.kCGWindowOwnerPID || 0))
      return {
        bundleId,
        displayName: window.kCGWindowOwnerName || window.kCGWindowName || bundleId || null,
        x: Math.round(bounds.X || 0),
        y: Math.round(bounds.Y || 0),
        width: Math.round(bounds.Width || 0),
        height: Math.round(bounds.Height || 0),
      }
    })
}

function listRunningApps() {
  const workspace = $.NSWorkspace.sharedWorkspace
  const apps = workspace.runningApplications.js
  return apps
    .filter(app => ObjC.unwrap(app.bundleIdentifier))
    .map(app => ({
      bundleId: ObjC.unwrap(app.bundleIdentifier),
      displayName: ObjC.unwrap(app.localizedName) || ObjC.unwrap(app.bundleIdentifier),
    }))
}

main()
