import { describe, expect, test } from 'bun:test'
import {
  createSyntheticAssistantMessage,
  createToolStub,
} from '../../src/remote/remotePermissionBridge.ts'

describe('remotePermissionBridge', () => {
  test('creates a synthetic assistant message for remote tool requests', () => {
    const request = {
      tool_use_id: 'tool-use-1',
      tool_name: 'mcp__github__list_issues',
      input: {
        owner: 'openai',
        repo: 'gpt',
      },
    }

    const message = createSyntheticAssistantMessage(request as never, 'req-123')

    expect(message.type).toBe('assistant')
    expect(message.uuid.length).toBeGreaterThan(0)
    expect(message.requestId).toBeUndefined()
    expect(new Date(message.timestamp).toString()).not.toBe('Invalid Date')
    expect(message.message).toMatchObject({
      id: 'remote-req-123',
      type: 'message',
      role: 'assistant',
      model: '',
      stop_reason: null,
      stop_sequence: null,
      container: null,
      context_management: null,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      content: [
        {
          type: 'tool_use',
          id: 'tool-use-1',
          name: 'mcp__github__list_issues',
          input: {
            owner: 'openai',
            repo: 'gpt',
          },
        },
      ],
    })
  })

  test('creates a stub tool that renders a compact fallback message', async () => {
    const tool = createToolStub('RemoteOnlyTool')

    expect(tool.name).toBe('RemoteOnlyTool')
    expect(tool.userFacingName()).toBe('RemoteOnlyTool')
    expect(tool.isEnabled()).toBe(true)
    expect(tool.isReadOnly()).toBe(false)
    expect(tool.needsPermissions()).toBe(true)
    expect(await tool.description()).toBe('')
    expect(tool.prompt()).toBe('')
    expect(await (tool.call as () => Promise<{ data: string }>)()).toEqual({
      data: '',
    })

    const rendered = tool.renderToolUseMessage({
      path: 'src/index.ts',
      options: { recursive: true, depth: 2 },
      retries: 3,
      ignored: 'fourth-field-should-not-render',
    })

    expect(rendered).toContain('path: src/index.ts')
    expect(rendered).toContain('options: {"recursive":true,"depth":2}')
    expect(rendered).toContain('retries: 3')
    expect(rendered).not.toContain('ignored:')
    expect(tool.renderToolUseMessage({})).toBe('')
  })
})
