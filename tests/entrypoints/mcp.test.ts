import { afterEach, describe, expect, mock, test } from 'bun:test'
import { z } from 'zod/v4'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

const moduleUrl = new URL('../../src/entrypoints/mcp.ts', import.meta.url).href
const reviewModuleUrl = new URL('../../src/commands/review.js', import.meta.url)
  .href
const actualModelModuleUrl = new URL(
  '../../src/utils/model/model.ts',
  import.meta.url,
).href
const modelModuleUrl = new URL(
  '../../src/utils/model/model.js',
  import.meta.url,
).href
const actualToolsModuleUrl = new URL('../../src/tools.ts', import.meta.url).href
const toolsModuleUrl = new URL('../../src/tools.js', import.meta.url).href
const actualShellModuleUrl = new URL(
  '../../src/utils/Shell.ts',
  import.meta.url,
).href
const shellModuleUrl = new URL('../../src/utils/Shell.js', import.meta.url).href

type MockTool = {
  name: string
  inputSchema: z.ZodTypeAny
  outputSchema?: z.ZodTypeAny
  prompt: (...args: unknown[]) => Promise<string>
  isEnabled: () => boolean
  validateInput?: (...args: unknown[]) => Promise<unknown>
  call: (...args: unknown[]) => Promise<unknown>
}

type MockState = {
  tools: MockTool[]
  handlers: Map<unknown, (request?: unknown) => Promise<unknown>>
  setCwdCalls: string[]
  connectedTransport: unknown | null
  serverInfo: unknown
  serverOptions: unknown
}

let importCounter = 0

function createMockState(): MockState {
  return {
    tools: [],
    handlers: new Map(),
    setCwdCalls: [],
    connectedTransport: null,
    serverInfo: null,
    serverOptions: null,
  }
}

async function importFreshMcpModule() {
  const state = createMockState()
  const actualModelModule = await import(actualModelModuleUrl)
  const actualToolsModule = await import(actualToolsModuleUrl)
  const actualShellModule = await import(actualShellModuleUrl)

  mock.module('@modelcontextprotocol/sdk/server/index.js', () => ({
    Server: class {
      constructor(info: unknown, options: unknown) {
        state.serverInfo = info
        state.serverOptions = options
      }

      setRequestHandler(
        schema: unknown,
        handler: (request?: unknown) => Promise<unknown>,
      ) {
        state.handlers.set(schema, handler)
      }

      async connect(transport: unknown) {
        state.connectedTransport = transport
      }
    },
  }))

  mock.module('@modelcontextprotocol/sdk/server/stdio.js', () => ({
    StdioServerTransport: class {},
  }))

  mock.module('src/state/AppStateStore.js', () => ({
    getDefaultAppState: () => ({}),
  }))

  mock.module(reviewModuleUrl, () => ({
    default: { name: 'review' },
  }))

  mock.module(modelModuleUrl, () => ({
    ...actualModelModule,
    getMainLoopModel: () => 'claude-test-model',
  }))

  mock.module(toolsModuleUrl, () => ({
    ...actualToolsModule,
    getTools: () => state.tools,
  }))

  mock.module(shellModuleUrl, () => ({
    ...actualShellModule,
    setCwd: (cwd: string) => {
      state.setCwdCalls.push(cwd)
    },
  }))

  importCounter += 1
  const module = (await import(
    `${moduleUrl}?case=${importCounter}`
  )) as typeof import('../../src/entrypoints/mcp.ts')

  return { module, state }
}

afterEach(() => {
  mock.restore()
})

describe('startMCPServer', () => {
  test('registers MCP handlers and exposes tool schemas safely', async () => {
    const { module, state } = await importFreshMcpModule()

    state.tools = [
      {
        name: 'ObjectTool',
        inputSchema: z.object({ value: z.string() }),
        outputSchema: z.object({ ok: z.boolean() }),
        prompt: async () => 'Object prompt',
        isEnabled: () => true,
        call: async () => ({ data: { ok: true } }),
      },
      {
        name: 'UnionTool',
        inputSchema: z.object({ count: z.number().optional() }),
        outputSchema: z.union([z.object({ ok: z.boolean() }), z.string()]),
        prompt: async () => 'Union prompt',
        isEnabled: () => true,
        call: async () => ({ data: 'unused' }),
      },
    ]

    await module.startMCPServer('/tmp/mcp-project', true, false)

    expect(state.setCwdCalls).toEqual(['/tmp/mcp-project'])
    expect(state.serverInfo).toEqual({
      name: 'claude/tengu',
      version: MACRO.VERSION,
    })
    expect(state.serverOptions).toEqual({
      capabilities: {
        tools: {},
      },
    })
    expect(state.connectedTransport).not.toBeNull()

    const listToolsHandler = state.handlers.get(ListToolsRequestSchema)
    expect(listToolsHandler).toBeDefined()

    const result = (await listToolsHandler?.()) as {
      tools: Array<{
        name: string
        description: string
        inputSchema: { type: string; properties?: Record<string, unknown> }
        outputSchema?: { type?: string; properties?: Record<string, unknown> }
      }>
    }

    expect(result.tools).toHaveLength(2)
    expect(result.tools[0]?.name).toBe('ObjectTool')
    expect(result.tools[0]?.description).toBe('Object prompt')
    expect(result.tools[0]?.inputSchema.type).toBe('object')
    expect(result.tools[0]?.inputSchema.properties).toHaveProperty('value')
    expect(result.tools[0]?.outputSchema?.type).toBe('object')
    expect(result.tools[0]?.outputSchema?.properties).toHaveProperty('ok')
    expect(result.tools[1]?.description).toBe('Union prompt')
    expect(result.tools[1]?.outputSchema).toBeUndefined()
  })

  test('calls tools and serializes validation, disabled, missing, and thrown errors', async () => {
    const { module, state } = await importFreshMcpModule()

    const echoTool: MockTool = {
      name: 'EchoTool',
      inputSchema: z.object({ value: z.string().optional() }),
      outputSchema: z.object({ echo: z.string() }),
      prompt: async () => 'Echo prompt',
      isEnabled: () => true,
      validateInput: async (args: { value?: string }) =>
        args.value === 'bad'
          ? { result: false, message: 'bad value', errorCode: 1 }
          : { result: true },
      call: async (args: { value?: string }) => ({
        data: { echo: args.value ?? 'default' },
      }),
    }

    await module.startMCPServer('/tmp/mcp-project', false, true)

    const callToolHandler = state.handlers.get(CallToolRequestSchema)
    expect(callToolHandler).toBeDefined()

    state.tools = [echoTool]
    const successResult = (await callToolHandler?.({
      params: {
        name: 'EchoTool',
        arguments: { value: 'hello' },
      },
    })) as {
      isError?: boolean
      content: Array<{ text: string }>
    }

    expect(successResult.isError).toBeUndefined()
    expect(successResult.content[0]?.text).toBe('{"echo":"hello"}')

    const invalidResult = (await callToolHandler?.({
      params: {
        name: 'EchoTool',
        arguments: { value: 'bad' },
      },
    })) as {
      isError?: boolean
      content: Array<{ text: string }>
    }

    expect(invalidResult.isError).toBe(true)
    expect(invalidResult.content[0]?.text).toContain('bad value')

    state.tools = [
      {
        ...echoTool,
        name: 'TextTool',
        validateInput: undefined,
        call: async () => 'plain text result',
      },
    ]
    const stringResult = (await callToolHandler?.({
      params: {
        name: 'TextTool',
        arguments: {},
      },
    })) as {
      isError?: boolean
      content: Array<{ text: string }>
    }
    expect(stringResult.content[0]?.text).toBe('plain text result')

    state.tools = [
      {
        ...echoTool,
        name: 'DisabledTool',
        isEnabled: () => false,
      },
    ]
    const disabledResult = (await callToolHandler?.({
      params: {
        name: 'DisabledTool',
        arguments: {},
      },
    })) as {
      isError?: boolean
      content: Array<{ text: string }>
    }
    expect(disabledResult.isError).toBe(true)
    expect(disabledResult.content[0]?.text).toContain('not enabled')

    state.tools = []
    await expect(
      callToolHandler?.({
        params: {
          name: 'MissingTool',
          arguments: {},
        },
      }),
    ).rejects.toThrow('Tool MissingTool not found')

    state.tools = [
      {
        ...echoTool,
        name: 'ExplodeTool',
        validateInput: undefined,
        call: async () => {
          throw new Error('tool exploded')
        },
      },
    ]
    const errorResult = (await callToolHandler?.({
      params: {
        name: 'ExplodeTool',
        arguments: {},
      },
    })) as {
      isError?: boolean
      content: Array<{ text: string }>
    }

    expect(errorResult.isError).toBe(true)
    expect(errorResult.content[0]?.text).toBe('tool exploded')
  })
})
