import axios from 'axios'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getCwd } from '../utils/cwd.js'
import { getGlobalConfig } from '../utils/config.js'
import { logForDebugging } from '../utils/debug.js'
import {
  checkAndRefreshOAuthTokenIfNeeded,
  getClaudeAIOAuthTokens,
} from '../utils/auth.js'
import { getOauthConfig, OAUTH_BETA_HEADER } from '../constants/oauth.js'
import { getClaudeCodeUserAgent } from '../utils/userAgent.js'
import {
  extractTextContent,
  getAssistantMessageText,
  getUserMessageText,
} from '../utils/messages.js'
import type { Message } from '../types/message.js'
import { getCompanion, type Companion } from './companion.js'

const REACTION_COOLDOWN_MS = 30_000
const MAX_RECENT_REACTIONS = 3
const MAX_DIFF_LINES = 80
const TEST_FAIL_RE =
  /\b[1-9]\d* (failed|failing)\b|\btests? failed\b|^FAIL(ED)?\b| ✗ | ✘ /im
const ERROR_RE =
  /\berror:|\bexception\b|\btraceback\b|\bpanicked at\b|\bfatal:|exit code [1-9]/i

let lastReactionAt = 0
let lastObservedMessageCount = 0
const recentReactions: string[] = []

function rememberReaction(reaction: string): void {
  recentReactions.push(reaction)
  if (recentReactions.length > MAX_RECENT_REACTIONS) {
    recentReactions.shift()
  }
}

export function getLastBuddyReaction(): string | undefined {
  return recentReactions.at(-1)
}

function isCompanionAddressed(messages: Message[], name: string): boolean {
  const lastUser = [...messages].reverse().find(
    message => message.type === 'user' && !message.isMeta,
  )
  const text = lastUser ? getUserMessageText(lastUser) ?? '' : ''
  return new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
    .test(text)
}

function extractRecentToolOutput(messages: Message[]): string {
  const outputs: string[] = []

  for (const message of messages) {
    if (message.type !== 'user') continue
    const content = message.message.content
    if (!Array.isArray(content)) continue

    for (const block of content) {
      if (block.type !== 'tool_result') continue
      if (typeof block.content === 'string') {
        outputs.push(block.content)
        continue
      }
      if (!Array.isArray(block.content)) continue
      for (const part of block.content) {
        if (part.type === 'text') {
          outputs.push(part.text)
        }
      }
    }
  }

  return outputs.join('\n')
}

function classifyReason(output: string): 'turn' | 'error' | 'test-fail' | 'large-diff' {
  if (TEST_FAIL_RE.test(output)) return 'test-fail'
  if (ERROR_RE.test(output)) return 'error'
  if (/^(@@ |diff )/m.test(output)) {
    const diffLines = output.match(/^[+-](?![+-])/gm)?.length ?? 0
    if (diffLines > MAX_DIFF_LINES) return 'large-diff'
  }
  return 'turn'
}

function buildTranscript(messages: Message[], toolOutput: string): string {
  const lines: string[] = []
  const recent = messages.slice(-12)

  for (const message of recent) {
    if (message.isMeta) continue
    if (message.type !== 'user' && message.type !== 'assistant') continue

    const text =
      message.type === 'user'
        ? getUserMessageText(message)
        : getAssistantMessageText(message)
    if (!text) continue

    lines.push(`${message.type === 'user' ? 'user' : 'claude'}: ${text.slice(0, 300)}`)
  }

  if (toolOutput) {
    lines.push(`[tool output]\n${toolOutput.slice(-1000)}`)
  }

  return lines.join('\n')
}

async function getProjectSummary(): Promise<string> {
  const lines: string[] = []

  try {
    const packageJson = await readFile(join(getCwd(), 'package.json'), 'utf-8')
    const parsed = JSON.parse(packageJson) as {
      name?: string
      description?: string
    }
    if (parsed.name) {
      lines.push(
        `project: ${parsed.name}${parsed.description ? ` - ${parsed.description}` : ''}`,
      )
    }
  } catch {}

  try {
    const proc = Bun.spawn(
      ['git', '--no-optional-locks', 'log', '--oneline', '-n', '3'],
      {
        cwd: getCwd(),
        stderr: 'ignore',
        stdout: 'pipe',
      },
    )
    const output = await new Response(proc.stdout).text()
    const trimmed = output.trim()
    if (trimmed) {
      lines.push(`recent commits:\n${trimmed}`)
    }
  } catch {}

  return lines.join('\n')
}

async function requestReaction(
  companion: Companion,
  transcript: string,
  reason: string,
  addressed: boolean,
  signal: AbortSignal,
): Promise<string | null> {
  const orgUUID = getGlobalConfig().oauthAccount?.organizationUuid
  if (!orgUUID) return null

  try {
    await checkAndRefreshOAuthTokenIfNeeded()
    const accessToken = getClaudeAIOAuthTokens()?.accessToken
    if (!accessToken) return null

    const response = await axios.post<{
      reaction?: string | null
    }>(
      `${getOauthConfig().BASE_API_URL}/api/organizations/${orgUUID}/claude_code/buddy_react`,
      {
        name: companion.name.slice(0, 32),
        personality: companion.personality.slice(0, 200),
        species: companion.species,
        rarity: companion.rarity,
        stats: companion.stats,
        transcript: transcript.slice(0, 5000),
        reason,
        recent: recentReactions.map(entry => entry.slice(0, 200)),
        addressed,
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'anthropic-beta': OAUTH_BETA_HEADER,
          'User-Agent': getClaudeCodeUserAgent(),
        },
        timeout: 10_000,
        signal,
      },
    )

    return response.data.reaction?.trim() || null
  } catch (error) {
    logForDebugging(`[buddy] api failed: ${error}`, { level: 'debug' })
    return null
  }
}

export async function triggerCompanionReaction(
  messages: Message[],
  onReaction: (reaction: string) => void,
): Promise<void> {
  const companion = getCompanion()
  if (!companion || getGlobalConfig().companionMuted) {
    lastObservedMessageCount = messages.length
    return
  }

  const addressed = isCompanionAddressed(messages, companion.name)
  const recentToolOutput = extractRecentToolOutput(messages.slice(lastObservedMessageCount))
  lastObservedMessageCount = messages.length
  const reason = addressed ? 'turn' : classifyReason(recentToolOutput)
  const now = Date.now()

  if (!addressed && reason === 'turn' && now - lastReactionAt < REACTION_COOLDOWN_MS) {
    return
  }

  const transcript = buildTranscript(messages, extractRecentToolOutput(messages.slice(-12)))
  if (!transcript.trim()) return

  lastReactionAt = now
  const reaction = await requestReaction(
    companion,
    transcript,
    reason,
    addressed,
    AbortSignal.timeout(10_000),
  )

  if (!reaction) return
  rememberReaction(reaction)
  onReaction(reaction)
}

export async function generateCompanionHatchReaction(
  companion: Companion,
  onReaction: (reaction: string) => void,
): Promise<void> {
  if (getGlobalConfig().companionMuted) return

  lastReactionAt = Date.now()
  const projectSummary =
    (await getProjectSummary()) || '(fresh project, nothing to see yet)'
  const reaction = await requestReaction(
    companion,
    projectSummary,
    'hatch',
    false,
    AbortSignal.timeout(10_000),
  )

  if (!reaction) return
  rememberReaction(reaction)
  onReaction(reaction)
}

export async function generateCompanionPetReaction(
  onReaction: (reaction: string) => void,
): Promise<void> {
  const companion = getCompanion()
  if (!companion) return

  lastReactionAt = Date.now()
  const reaction = await requestReaction(
    companion,
    '(you were just petted)',
    'pet',
    false,
    AbortSignal.timeout(10_000),
  )

  if (!reaction) return
  rememberReaction(reaction)
  onReaction(reaction)
}
