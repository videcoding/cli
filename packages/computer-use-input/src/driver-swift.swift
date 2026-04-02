import AppKit
import ApplicationServices
import Foundation

struct Payload: Decodable {
  let op: String
  let x: Double?
  let y: Double?
  let dragButton: String?
  let button: String?
  let action: String?
  let count: Int?
  let amount: Double?
  let axis: String?
  let text: String?
  let key: String?
  let keys: [String]?
}

struct DriverError: Error, CustomStringConvertible {
  let description: String

  init(_ description: String) {
    self.description = description
  }
}

let buttonCodes: [String: CGMouseButton] = [
  "left": .left,
  "right": .right,
  "middle": .center,
]

let buttonEventTypes: [String: (down: CGEventType, up: CGEventType, dragged: CGEventType)] = [
  "left": (.leftMouseDown, .leftMouseUp, .leftMouseDragged),
  "right": (.rightMouseDown, .rightMouseUp, .rightMouseDragged),
  "middle": (.otherMouseDown, .otherMouseUp, .otherMouseDragged),
]

let keyCodes: [String: CGKeyCode] = [
  "a": 0,
  "s": 1,
  "d": 2,
  "f": 3,
  "h": 4,
  "g": 5,
  "z": 6,
  "x": 7,
  "c": 8,
  "v": 9,
  "b": 11,
  "q": 12,
  "w": 13,
  "e": 14,
  "r": 15,
  "y": 16,
  "t": 17,
  "1": 18,
  "2": 19,
  "3": 20,
  "4": 21,
  "6": 22,
  "5": 23,
  "=": 24,
  "9": 25,
  "7": 26,
  "-": 27,
  "8": 28,
  "0": 29,
  "]": 30,
  "o": 31,
  "u": 32,
  "[": 33,
  "i": 34,
  "p": 35,
  "return": 36,
  "l": 37,
  "j": 38,
  "'": 39,
  "k": 40,
  ";": 41,
  "\\": 42,
  ",": 43,
  "/": 44,
  "n": 45,
  "m": 46,
  ".": 47,
  "tab": 48,
  "space": 49,
  "`": 50,
  "delete": 51,
  "escape": 53,
  "command": 55,
  "shift": 56,
  "capslock": 57,
  "option": 58,
  "control": 59,
  "rightshift": 60,
  "rightoption": 61,
  "rightcontrol": 62,
  "function": 63,
  "f17": 64,
  "volumeup": 72,
  "volumedown": 73,
  "mute": 74,
  "enter": 76,
  "f18": 79,
  "f19": 80,
  "f20": 90,
  "f5": 96,
  "f6": 97,
  "f7": 98,
  "f3": 99,
  "f8": 100,
  "f9": 101,
  "f11": 103,
  "f13": 105,
  "f16": 106,
  "f14": 107,
  "f10": 109,
  "f12": 111,
  "f15": 113,
  "help": 114,
  "home": 115,
  "pageup": 116,
  "forwarddelete": 117,
  "f4": 118,
  "end": 119,
  "f2": 120,
  "pagedown": 121,
  "f1": 122,
  "left": 123,
  "right": 124,
  "down": 125,
  "up": 126,
]

let modifierFlags: [String: CGEventFlags] = [
  "command": .maskCommand,
  "shift": .maskShift,
  "option": .maskAlternate,
  "control": .maskControl,
]

func emit(_ value: Any) throws {
  let data = try JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed])
  FileHandle.standardOutput.write(data)
}

func requireValue<T>(_ value: T?, _ message: String) throws -> T {
  guard let value else {
    throw DriverError(message)
  }
  return value
}

func currentMouseLocation() -> CGPoint {
  CGEvent(source: nil)?.location ?? NSEvent.mouseLocation
}

func postMouseEvent(
  _ type: CGEventType,
  location: CGPoint,
  buttonName: String,
  clickState: Int64? = nil
) throws {
  let button = buttonCodes[buttonName] ?? .left
  guard let event = CGEvent(
    mouseEventSource: nil,
    mouseType: type,
    mouseCursorPosition: location,
    mouseButton: button
  ) else {
    throw DriverError("Unable to create mouse event")
  }
  if let clickState {
    event.setIntegerValueField(.mouseEventClickState, value: clickState)
  }
  event.post(tap: .cghidEventTap)
}

func moveMouse(_ x: Double, _ y: Double, _ dragButton: String?) throws -> Bool {
  let location = CGPoint(x: x, y: y)
  if let dragButton, !dragButton.isEmpty {
    let types = buttonEventTypes[dragButton]
    try postMouseEvent(types?.dragged ?? .leftMouseDragged, location: location, buttonName: dragButton)
    return true
  }
  try postMouseEvent(.mouseMoved, location: location, buttonName: "left")
  return true
}

func mouseButton(_ button: String, _ action: String?, _ count: Int?) throws -> Bool {
  guard let types = buttonEventTypes[button] else {
    throw DriverError("Unsupported mouse button: \(button)")
  }

  let location = currentMouseLocation()
  let normalizedAction: String
  switch (action ?? "click").lowercased() {
  case "press":
    normalizedAction = "down"
  case "release":
    normalizedAction = "up"
  default:
    normalizedAction = (action ?? "click").lowercased()
  }

  if normalizedAction == "click" {
    let clickCount = max(1, count ?? 1)
    for index in 1...clickCount {
      try postMouseEvent(types.down, location: location, buttonName: button, clickState: Int64(index))
      try postMouseEvent(types.up, location: location, buttonName: button, clickState: Int64(index))
    }
    return true
  }

  let eventType: CGEventType
  switch normalizedAction {
  case "down":
    eventType = types.down
  case "up":
    eventType = types.up
  default:
    throw DriverError("Unsupported mouse action: \(action ?? "nil")")
  }

  try postMouseEvent(eventType, location: location, buttonName: button, clickState: Int64(max(1, count ?? 1)))
  return true
}

func mouseLocation() -> [String: Int] {
  let location = currentMouseLocation()
  return [
    "x": Int(lround(location.x)),
    "y": Int(lround(location.y)),
  ]
}

func mouseScroll(_ amount: Double, _ axis: String?) throws -> Bool {
  let normalizedAxis = (axis ?? "vertical").lowercased()
  let vertical = normalizedAxis == "y" || normalizedAxis == "vertical" ? Int32(lround(amount)) : 0
  let horizontal = normalizedAxis == "x" || normalizedAxis == "horizontal" ? Int32(lround(amount)) : 0

  guard let event = CGEvent(
    scrollWheelEvent2Source: nil,
    units: .pixel,
    wheelCount: 2,
    wheel1: vertical,
    wheel2: horizontal,
    wheel3: 0
  ) else {
    throw DriverError("Unable to create scroll event")
  }

  event.post(tap: .cghidEventTap)
  return true
}

func typeText(_ text: String) throws -> Bool {
  guard let source = CGEventSource(stateID: .hidSystemState) else {
    throw DriverError("Unable to create keyboard event source")
  }

  for scalar in text.utf16 {
    var chars = [scalar]

    guard let down = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true) else {
      throw DriverError("Unable to create key down event")
    }
    down.keyboardSetUnicodeString(stringLength: chars.count, unicodeString: &chars)
    down.post(tap: .cghidEventTap)

    guard let up = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false) else {
      throw DriverError("Unable to create key up event")
    }
    up.keyboardSetUnicodeString(stringLength: chars.count, unicodeString: &chars)
    up.post(tap: .cghidEventTap)
  }

  return true
}

func key(_ name: String, _ action: String?) throws -> Bool {
  let normalizedName = name.lowercased()
  guard let keyCode = keyCodes[normalizedName] else {
    throw DriverError("Unsupported key: \(name)")
  }

  let normalizedAction = (action ?? "press").lowercased()
  switch normalizedAction {
  case "down", "up", "press", "release":
    break
  default:
    throw DriverError("Unsupported key action: \(action ?? "nil")")
  }

  let isDown = normalizedAction == "down" || normalizedAction == "press"
  guard let event = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: isDown) else {
    throw DriverError("Unable to create keyboard event")
  }
  event.post(tap: .cghidEventTap)
  return true
}

func keys(_ names: [String]) throws -> Bool {
  var flags: CGEventFlags = []

  for name in names {
    let normalizedName = name.lowercased()
    guard let keyCode = keyCodes[normalizedName] else {
      throw DriverError("Unsupported key: \(name)")
    }
    guard let event = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: true) else {
      throw DriverError("Unable to create key down event")
    }

    if let modifierFlag = modifierFlags[normalizedName] {
      flags.insert(modifierFlag)
      event.flags = flags
    } else if !flags.isEmpty {
      event.flags = flags
    }

    event.post(tap: .cghidEventTap)
  }

  for name in names.reversed() {
    let normalizedName = name.lowercased()
    guard let keyCode = keyCodes[normalizedName] else {
      throw DriverError("Unsupported key: \(name)")
    }
    guard let event = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: false) else {
      throw DriverError("Unable to create key up event")
    }

    if let modifierFlag = modifierFlags[normalizedName] {
      flags.remove(modifierFlag)
      if !flags.isEmpty {
        event.flags = flags
      }
    } else if !flags.isEmpty {
      event.flags = flags
    }

    event.post(tap: .cghidEventTap)
  }

  return true
}

func frontmostAppInfo() -> Any {
  guard let app = NSWorkspace.shared.frontmostApplication else {
    return NSNull()
  }

  var result: [String: String] = [:]
  if let bundleId = app.bundleIdentifier {
    result["bundleId"] = bundleId
  }
  if let name = app.localizedName {
    result["appName"] = name
    result["name"] = name
  }
  return result
}

func dispatch(_ payload: Payload) throws -> Any {
  switch payload.op {
  case "moveMouse":
    return try moveMouse(
      try requireValue(payload.x, "Missing x for moveMouse"),
      try requireValue(payload.y, "Missing y for moveMouse"),
      payload.dragButton
    )
  case "mouseButton":
    return try mouseButton(
      try requireValue(payload.button, "Missing button for mouseButton"),
      payload.action,
      payload.count
    )
  case "mouseLocation":
    return mouseLocation()
  case "mouseScroll":
    return try mouseScroll(try requireValue(payload.amount, "Missing amount for mouseScroll"), payload.axis)
  case "typeText":
    return try typeText(try requireValue(payload.text, "Missing text for typeText"))
  case "key":
    return try key(
      try requireValue(payload.key, "Missing key for key"),
      payload.action
    )
  case "keys":
    return try keys(try requireValue(payload.keys, "Missing keys for keys"))
  case "frontmostAppInfo":
    return frontmostAppInfo()
  default:
    throw DriverError("Unsupported operation: \(payload.op)")
  }
}

func main() throws {
  guard CommandLine.arguments.count >= 2, let json = CommandLine.arguments.last else {
    throw DriverError("Expected JSON payload argument")
  }

  let payload = try JSONDecoder().decode(Payload.self, from: Data(json.utf8))
  try emit(try dispatch(payload))
}

do {
  try main()
} catch {
  let message = String(describing: error)
  FileHandle.standardError.write(Data((message + "\n").utf8))
  exit(1)
}
