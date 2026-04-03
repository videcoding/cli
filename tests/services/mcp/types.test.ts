import { describe, expect, test } from 'bun:test'
import {
  ConfigScopeSchema,
  McpHTTPServerConfigSchema,
  McpJsonConfigSchema,
  McpSSEIDEServerConfigSchema,
  McpSSEServerConfigSchema,
  McpSdkServerConfigSchema,
  McpServerConfigSchema,
  McpStdioServerConfigSchema,
  McpWebSocketIDEServerConfigSchema,
  McpWebSocketServerConfigSchema,
  TransportSchema,
} from '../../../src/services/mcp/types.ts'

describe('mcp types', () => {
  test('validates config scopes and transport enums', () => {
    expect(ConfigScopeSchema().parse('enterprise')).toBe('enterprise')
    expect(TransportSchema().parse('sdk')).toBe('sdk')
    expect(ConfigScopeSchema().safeParse('unknown').success).toBe(false)
    expect(TransportSchema().safeParse('grpc').success).toBe(false)
  })

  test('parses stdio, sse, http, websocket, sdk, and proxy server configs', () => {
    expect(
      McpStdioServerConfigSchema().parse({
        command: 'node',
      }),
    ).toEqual({
      command: 'node',
      args: [],
    })

    expect(
      McpSSEServerConfigSchema().parse({
        type: 'sse',
        url: 'https://example.com/sse',
        headers: { Authorization: 'Bearer test' },
        oauth: {
          clientId: 'client-1',
          callbackPort: 3000,
          authServerMetadataUrl: 'https://example.com/.well-known/oauth',
          xaa: true,
        },
      }),
    ).toMatchObject({
      type: 'sse',
      oauth: { xaa: true },
    })

    expect(
      McpHTTPServerConfigSchema().parse({
        type: 'http',
        url: 'https://example.com/http',
        headersHelper: 'node helper.js',
      }),
    ).toMatchObject({ type: 'http' })

    expect(
      McpWebSocketServerConfigSchema().parse({
        type: 'ws',
        url: 'wss://example.com/socket',
      }),
    ).toMatchObject({ type: 'ws' })

    expect(
      McpSSEIDEServerConfigSchema().parse({
        type: 'sse-ide',
        url: 'http://127.0.0.1:3333',
        ideName: 'cursor',
      }),
    ).toMatchObject({ type: 'sse-ide', ideName: 'cursor' })

    expect(
      McpWebSocketIDEServerConfigSchema().parse({
        type: 'ws-ide',
        url: 'ws://127.0.0.1:4444',
        ideName: 'vscode',
        authToken: 'secret',
      }),
    ).toMatchObject({ type: 'ws-ide', ideName: 'vscode' })

    expect(
      McpSdkServerConfigSchema().parse({
        type: 'sdk',
        name: 'internal-sdk',
      }),
    ).toMatchObject({ type: 'sdk', name: 'internal-sdk' })

    expect(
      McpServerConfigSchema().parse({
        type: 'claudeai-proxy',
        url: 'https://claude.ai/mcp',
        id: 'server-123',
      }),
    ).toMatchObject({ type: 'claudeai-proxy', id: 'server-123' })
  })

  test('rejects invalid oauth metadata urls and malformed json config payloads', () => {
    const invalidOauth = McpSSEServerConfigSchema().safeParse({
      type: 'sse',
      url: 'https://example.com/sse',
      oauth: {
        authServerMetadataUrl: 'http://example.com/oauth',
      },
    })
    expect(invalidOauth.success).toBe(false)
    if (invalidOauth.success) {
      throw new Error('expected oauth validation to fail')
    }
    expect(invalidOauth.error.issues[0]?.message).toContain(
      'authServerMetadataUrl must use https://',
    )

    const invalidJsonConfig = McpJsonConfigSchema().safeParse({
      mcpServers: {
        broken: {
          type: 'stdio',
          command: '',
        },
      },
    })
    expect(invalidJsonConfig.success).toBe(false)
  })
})
