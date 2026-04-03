import { afterEach, describe, expect, mock, test } from 'bun:test'

const moduleUrl = new URL(
  '../../src/remote/RemoteSessionManager.ts',
  import.meta.url,
).href
const sessionsWebSocketModuleUrl = new URL(
  '../../src/remote/SessionsWebSocket.js',
  import.meta.url,
).href
const teleportApiModuleUrl = new URL(
  '../../src/utils/teleport/api.js',
  import.meta.url,
).href
const debugModuleUrl = new URL('../../src/utils/debug.js', import.meta.url)
  .href
const logModuleUrl = new URL('../../src/utils/log.js', import.meta.url).href

type MockState = {
  debugLogs: string[]
  errors: unknown[]
  sentEvents: unknown[][]
  sendEventResult: boolean
  instances: FakeSessionsWebSocket[]
}

type FakeSessionsWebSocket = {
  sessionId: string
  orgUuid: string
  getAccessToken: () => string
  callbacks: {
    onMessage: (message: unknown) => void
    onConnected?: () => void
    onClose?: () => void
    onReconnecting?: () => void
    onError?: (error: Error) => void
  }
  connected: boolean
  connectCalls: number
  closeCalls: number
  reconnectCalls: number
  controlRequests: unknown[]
  controlResponses: unknown[]
  connect: () => Promise<void>
  sendControlRequest: (request: unknown) => void
  sendControlResponse: (response: unknown) => void
  isConnected: () => boolean
  close: () => void
  reconnect: () => void
}

let importCounter = 0

function createMockState(): MockState {
  return {
    debugLogs: [],
    errors: [],
    sentEvents: [],
    sendEventResult: true,
    instances: [],
  }
}

async function importFreshRemoteSessionManagerModule() {
  const state = createMockState()

  mock.module(debugModuleUrl, () => ({
    logForDebugging: (message: string) => {
      state.debugLogs.push(message)
    },
  }))

  mock.module(logModuleUrl, () => ({
    logError: (error: unknown) => {
      state.errors.push(error)
    },
  }))

  mock.module(teleportApiModuleUrl, () => ({
    sendEventToRemoteSession: async (...args: unknown[]) => {
      state.sentEvents.push(args)
      return state.sendEventResult
    },
  }))

  mock.module(sessionsWebSocketModuleUrl, () => ({
    SessionsWebSocket: class {
      sessionId: string
      orgUuid: string
      getAccessToken: () => string
      callbacks: FakeSessionsWebSocket['callbacks']
      connected = false
      connectCalls = 0
      closeCalls = 0
      reconnectCalls = 0
      controlRequests: unknown[] = []
      controlResponses: unknown[] = []

      constructor(
        sessionId: string,
        orgUuid: string,
        getAccessToken: () => string,
        callbacks: FakeSessionsWebSocket['callbacks'],
      ) {
        this.sessionId = sessionId
        this.orgUuid = orgUuid
        this.getAccessToken = getAccessToken
        this.callbacks = callbacks
        state.instances.push(this as FakeSessionsWebSocket)
      }

      async connect() {
        this.connectCalls += 1
      }

      sendControlRequest(request: unknown) {
        this.controlRequests.push(request)
      }

      sendControlResponse(response: unknown) {
        this.controlResponses.push(response)
      }

      isConnected() {
        return this.connected
      }

      close() {
        this.closeCalls += 1
        this.connected = false
      }

      reconnect() {
        this.reconnectCalls += 1
      }
    },
  }))

  importCounter += 1
  const module = await import(`${moduleUrl}?case=${importCounter}`)
  return { module, state }
}

afterEach(() => {
  mock.restore()
})

describe('RemoteSessionManager', () => {
  test('creates config objects with sensible defaults', async () => {
    const { module } = await importFreshRemoteSessionManagerModule()
    const getAccessToken = () => 'token'

    expect(
      module.createRemoteSessionConfig('session-1', getAccessToken, 'org-1'),
    ).toEqual({
      sessionId: 'session-1',
      getAccessToken,
      orgUuid: 'org-1',
      hasInitialPrompt: false,
      viewerOnly: false,
    })

    expect(
      module.createRemoteSessionConfig(
        'session-2',
        getAccessToken,
        'org-2',
        true,
        true,
      ),
    ).toEqual({
      sessionId: 'session-2',
      getAccessToken,
      orgUuid: 'org-2',
      hasInitialPrompt: true,
      viewerOnly: true,
    })
  })

  test('connects to the websocket and forwards lifecycle callbacks', async () => {
    const { module, state } = await importFreshRemoteSessionManagerModule()
    const callbacks = {
      onMessage: mock(() => {}),
      onPermissionRequest: mock(() => {}),
      onPermissionCancelled: mock(() => {}),
      onConnected: mock(() => {}),
      onDisconnected: mock(() => {}),
      onReconnecting: mock(() => {}),
      onError: mock(() => {}),
    }

    const manager = new module.RemoteSessionManager(
      {
        sessionId: 'session-1',
        getAccessToken: () => 'token-1',
        orgUuid: 'org-1',
      },
      callbacks,
    )

    manager.connect()

    expect(state.instances).toHaveLength(1)
    const socket = state.instances[0]!
    expect(socket.connectCalls).toBe(1)
    expect(socket.sessionId).toBe('session-1')
    expect(socket.orgUuid).toBe('org-1')
    expect(socket.getAccessToken()).toBe('token-1')
    expect(manager.getSessionId()).toBe('session-1')
    expect(manager.isConnected()).toBe(false)

    socket.connected = true
    socket.callbacks.onConnected?.()
    socket.callbacks.onReconnecting?.()
    socket.callbacks.onClose?.()

    const error = new Error('socket failed')
    socket.callbacks.onError?.(error)

    expect(callbacks.onConnected).toHaveBeenCalledTimes(1)
    expect(callbacks.onReconnecting).toHaveBeenCalledTimes(1)
    expect(callbacks.onDisconnected).toHaveBeenCalledTimes(1)
    expect(callbacks.onError).toHaveBeenCalledWith(error)
    expect(state.errors).toContain(error)

    socket.connected = true
    expect(manager.isConnected()).toBe(true)

    manager.cancelSession()
    expect(socket.controlRequests).toEqual([{ subtype: 'interrupt' }])

    manager.reconnect()
    expect(socket.reconnectCalls).toBe(1)

    manager.disconnect()
    expect(socket.closeCalls).toBe(1)
    expect(manager.isConnected()).toBe(false)
  })

  test('routes SDK messages and permission request lifecycle events', async () => {
    const { module, state } = await importFreshRemoteSessionManagerModule()
    const callbacks = {
      onMessage: mock(() => {}),
      onPermissionRequest: mock(() => {}),
      onPermissionCancelled: mock(() => {}),
    }

    const manager = new module.RemoteSessionManager(
      {
        sessionId: 'session-2',
        getAccessToken: () => 'token-2',
        orgUuid: 'org-2',
      },
      callbacks as never,
    )
    manager.connect()

    const socket = state.instances[0]!
    const sdkMessage = {
      type: 'assistant',
      message: 'hello from remote',
    }
    socket.callbacks.onMessage(sdkMessage)

    expect(callbacks.onMessage).toHaveBeenCalledWith(sdkMessage)

    const permissionRequest = {
      type: 'control_request',
      request_id: 'perm-1',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'TestingPermission',
        tool_use_id: 'tool-1',
        input: {},
      },
    }
    socket.callbacks.onMessage(permissionRequest)

    expect(callbacks.onPermissionRequest).toHaveBeenCalledWith(
      permissionRequest.request,
      'perm-1',
    )

    socket.callbacks.onMessage({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: 'perm-1',
      },
    })

    expect(callbacks.onMessage).toHaveBeenCalledTimes(1)

    socket.callbacks.onMessage({
      type: 'control_cancel_request',
      request_id: 'perm-1',
    })

    expect(callbacks.onPermissionCancelled).toHaveBeenCalledWith(
      'perm-1',
      'tool-1',
    )
  })

  test('returns explicit errors for unsupported control requests and missing responses', async () => {
    const { module, state } = await importFreshRemoteSessionManagerModule()
    const callbacks = {
      onMessage: mock(() => {}),
      onPermissionRequest: mock(() => {}),
    }

    const manager = new module.RemoteSessionManager(
      {
        sessionId: 'session-3',
        getAccessToken: () => 'token-3',
        orgUuid: 'org-3',
      },
      callbacks as never,
    )
    manager.connect()

    const socket = state.instances[0]!
    socket.callbacks.onMessage({
      type: 'control_request',
      request_id: 'bad-1',
      request: {
        subtype: 'unsupported_subtype',
      },
    })

    expect(socket.controlResponses).toEqual([
      {
        type: 'control_response',
        response: {
          subtype: 'error',
          request_id: 'bad-1',
          error: 'Unsupported control request subtype: unsupported_subtype',
        },
      },
    ])

    manager.respondToPermissionRequest('missing-request', {
      behavior: 'deny',
      message: 'denied',
    })

    expect((state.errors[0] as Error).message).toContain(
      'No pending permission request with ID: missing-request',
    )
  })

  test('sends permission responses and logs failed outbound remote messages', async () => {
    const { module, state } = await importFreshRemoteSessionManagerModule()
    const manager = new module.RemoteSessionManager(
      {
        sessionId: 'session-4',
        getAccessToken: () => 'token-4',
        orgUuid: 'org-4',
      },
      {
        onMessage: () => {},
        onPermissionRequest: () => {},
      },
    )
    manager.connect()

    const socket = state.instances[0]!
    socket.callbacks.onMessage({
      type: 'control_request',
      request_id: 'perm-allow',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'TestingPermission',
        tool_use_id: 'tool-allow',
        input: { force: true },
      },
    })
    socket.callbacks.onMessage({
      type: 'control_request',
      request_id: 'perm-deny',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'TestingPermission',
        tool_use_id: 'tool-deny',
        input: {},
      },
    })

    manager.respondToPermissionRequest('perm-allow', {
      behavior: 'allow',
      updatedInput: { force: false },
    })
    manager.respondToPermissionRequest('perm-deny', {
      behavior: 'deny',
      message: 'No thanks',
    })

    expect(socket.controlResponses).toEqual([
      {
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: 'perm-allow',
          response: {
            behavior: 'allow',
            updatedInput: { force: false },
          },
        },
      },
      {
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: 'perm-deny',
          response: {
            behavior: 'deny',
            message: 'No thanks',
          },
        },
      },
    ])

    expect(
      await manager.sendMessage(
        {
          type: 'user',
          message: 'hello',
        } as never,
        { uuid: 'event-1' },
      ),
    ).toBe(true)
    expect(state.sentEvents).toEqual([
      [
        'session-4',
        {
          type: 'user',
          message: 'hello',
        },
        { uuid: 'event-1' },
      ],
    ])

    state.sendEventResult = false
    expect(
      await manager.sendMessage({
        type: 'user',
        message: 'retry',
      } as never),
    ).toBe(false)
    expect((state.errors.at(-1) as Error).message).toContain(
      'Failed to send message to session session-4',
    )
  })
})
