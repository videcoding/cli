ObjC.import('AppKit')
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
    case 'moveMouse':
      return moveMouse(payload.x, payload.y, payload.dragButton)
    case 'mouseButton':
      return mouseButton(payload.button, payload.action, payload.count)
    case 'mouseLocation':
      return mouseLocation()
    case 'mouseScroll':
      return mouseScroll(payload.amount, payload.axis)
    case 'typeText':
      return typeText(payload.text)
    case 'key':
      return key(payload.key, payload.action)
    case 'keys':
      return keys(payload.keys)
    case 'frontmostAppInfo':
      return frontmostAppInfo()
    default:
      throw new Error(`Unsupported operation: ${payload.op}`)
  }
}

const BUTTON_CODES = {
  left: 0,
  right: 1,
  middle: 2,
}

const BUTTON_EVENT_TYPES = {
  left: {
    down: $.kCGEventLeftMouseDown,
    up: $.kCGEventLeftMouseUp,
    dragged: $.kCGEventLeftMouseDragged,
  },
  right: {
    down: $.kCGEventRightMouseDown,
    up: $.kCGEventRightMouseUp,
    dragged: $.kCGEventRightMouseDragged,
  },
  middle: {
    down: $.kCGEventOtherMouseDown,
    up: $.kCGEventOtherMouseUp,
    dragged: $.kCGEventOtherMouseDragged,
  },
}

const KEY_CODES = {
  a: 0,
  s: 1,
  d: 2,
  f: 3,
  h: 4,
  g: 5,
  z: 6,
  x: 7,
  c: 8,
  v: 9,
  b: 11,
  q: 12,
  w: 13,
  e: 14,
  r: 15,
  y: 16,
  t: 17,
  '1': 18,
  '2': 19,
  '3': 20,
  '4': 21,
  '6': 22,
  '5': 23,
  '=': 24,
  '9': 25,
  '7': 26,
  '-': 27,
  '8': 28,
  '0': 29,
  ']': 30,
  o: 31,
  u: 32,
  '[': 33,
  i: 34,
  p: 35,
  l: 37,
  j: 38,
  "'": 39,
  k: 40,
  ';': 41,
  '\\': 42,
  ',': 43,
  '/': 44,
  n: 45,
  m: 46,
  '.': 47,
  '`': 50,
  return: 36,
  enter: 76,
  tab: 48,
  space: 49,
  delete: 51,
  escape: 53,
  command: 55,
  shift: 56,
  capslock: 57,
  option: 58,
  control: 59,
  rightshift: 60,
  rightoption: 61,
  rightcontrol: 62,
  function: 63,
  f17: 64,
  volumeup: 72,
  volumedown: 73,
  mute: 74,
  f18: 79,
  f19: 80,
  f20: 90,
  f5: 96,
  f6: 97,
  f7: 98,
  f3: 99,
  f8: 100,
  f9: 101,
  f11: 103,
  f13: 105,
  f16: 106,
  f14: 107,
  f10: 109,
  f12: 111,
  f15: 113,
  help: 114,
  home: 115,
  pageup: 116,
  forwarddelete: 117,
  f4: 118,
  end: 119,
  f2: 120,
  pagedown: 121,
  f1: 122,
  left: 123,
  right: 124,
  down: 125,
  up: 126,
}

const MODIFIER_FLAGS = {
  command: $.kCGEventFlagMaskCommand,
  shift: $.kCGEventFlagMaskShift,
  option: $.kCGEventFlagMaskAlternate,
  control: $.kCGEventFlagMaskControl,
}

function point(x, y) {
  return $.CGPointMake(x, y)
}

function postMouseEvent(type, location, button, clickState) {
  const event = $.CGEventCreateMouseEvent(
    null,
    type,
    location,
    BUTTON_CODES[button] ?? 0,
  )
  if (clickState !== undefined) {
    $.CGEventSetIntegerValueField(event, $.kCGMouseEventClickState, clickState)
  }
  $.CGEventPost($.kCGHIDEventTap, event)
  $.CFRelease(event)
}

function currentMouseLocation() {
  const event = $.CGEventCreate(null)
  const location = $.CGEventGetLocation(event)
  $.CFRelease(event)
  return location
}

function moveMouse(x, y, dragButton) {
  const location = point(x, y)
  if (dragButton) {
    const types = BUTTON_EVENT_TYPES[dragButton]
    postMouseEvent(types?.dragged ?? $.kCGEventLeftMouseDragged, location, dragButton)
    return true
  }
  postMouseEvent($.kCGEventMouseMoved, location, 'left')
  return true
}

function mouseButton(button, action, count) {
  const location = currentMouseLocation()
  const types = BUTTON_EVENT_TYPES[button]
  if (!types) {
    throw new Error(`Unsupported mouse button: ${button}`)
  }
  const normalizedAction =
    action === 'press' ? 'down' : action === 'release' ? 'up' : action
  if (normalizedAction === 'click') {
    const clickCount = Math.max(1, Number(count) || 1)
    for (let i = 1; i <= clickCount; i++) {
      postMouseEvent(types.down, location, button, i)
      postMouseEvent(types.up, location, button, i)
    }
    return true
  }
  const type = types[normalizedAction]
  if (type === undefined) {
    throw new Error(`Unsupported mouse action: ${action}`)
  }
  postMouseEvent(type, location, button, count)
  return true
}

function mouseLocation() {
  const location = currentMouseLocation()
  return { x: Math.round(location.x), y: Math.round(location.y) }
}

function mouseScroll(amount, axis) {
  const vertical = axis === 'y' || axis === 'vertical' ? amount : 0
  const horizontal = axis === 'x' || axis === 'horizontal' ? amount : 0
  const event = $.CGEventCreateScrollWheelEvent(
    null,
    $.kCGScrollEventUnitPixel,
    2,
    vertical,
    horizontal,
  )
  $.CGEventPost($.kCGHIDEventTap, event)
  $.CFRelease(event)
  return true
}

function typeText(text) {
  const source = $.CGEventSourceCreate($.kCGEventSourceStateHIDSystemState)
  for (const ch of text) {
    const down = $.CGEventCreateKeyboardEvent(source, 0, true)
    $.CGEventKeyboardSetUnicodeString(down, 1, $(ch))
    $.CGEventPost($.kCGHIDEventTap, down)
    $.CFRelease(down)

    const up = $.CGEventCreateKeyboardEvent(source, 0, false)
    $.CGEventKeyboardSetUnicodeString(up, 1, $(ch))
    $.CGEventPost($.kCGHIDEventTap, up)
    $.CFRelease(up)
  }
  $.CFRelease(source)
  return true
}

function key(name, action) {
  const keyCode = KEY_CODES[String(name).toLowerCase()]
  if (keyCode === undefined) {
    throw new Error(`Unsupported key: ${name}`)
  }
  const normalizedAction = String(action ?? 'press').toLowerCase()
  if (
    normalizedAction !== 'down' &&
    normalizedAction !== 'up' &&
    normalizedAction !== 'press' &&
    normalizedAction !== 'release'
  ) {
    throw new Error(`Unsupported key action: ${action}`)
  }
  const isDown = normalizedAction === 'down' || normalizedAction === 'press'
  const event = $.CGEventCreateKeyboardEvent(null, keyCode, isDown)
  $.CGEventPost($.kCGHIDEventTap, event)
  $.CFRelease(event)
  return true
}

function keys(names) {
  let flags = 0
  for (const name of names) {
    const normalized = String(name).toLowerCase()
    const keyCode = KEY_CODES[normalized]
    if (keyCode === undefined) {
      throw new Error(`Unsupported key: ${name}`)
    }
    const event = $.CGEventCreateKeyboardEvent(null, keyCode, true)
    const modifierFlag = MODIFIER_FLAGS[normalized]
    if (modifierFlag) {
      flags |= modifierFlag
      $.CGEventSetFlags(event, flags)
    } else if (flags) {
      $.CGEventSetFlags(event, flags)
    }
    $.CGEventPost($.kCGHIDEventTap, event)
    $.CFRelease(event)
  }

  for (const name of [...names].reverse()) {
    const normalized = String(name).toLowerCase()
    const keyCode = KEY_CODES[normalized]
    const event = $.CGEventCreateKeyboardEvent(null, keyCode, false)
    const modifierFlag = MODIFIER_FLAGS[normalized]
    if (modifierFlag) {
      flags &= ~modifierFlag
      $.CGEventSetFlags(event, flags)
    } else if (flags) {
      $.CGEventSetFlags(event, flags)
    }
    $.CGEventPost($.kCGHIDEventTap, event)
    $.CFRelease(event)
  }
  return true
}

function frontmostAppInfo() {
  const workspace = $.NSWorkspace.sharedWorkspace
  const app = workspace.frontmostApplication
  if (!app) {
    return null
  }
  const name = ObjC.unwrap(app.localizedName)
  return {
    bundleId: ObjC.unwrap(app.bundleIdentifier),
    appName: name,
    name,
  }
}

main()
