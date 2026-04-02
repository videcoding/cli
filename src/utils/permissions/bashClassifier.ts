import { BASH_TOOL_NAME } from '../../tools/BashTool/toolName.js'
import type {
  ToolPermissionContext,
  ToolPermissionRulesBySource,
} from '../../types/permissions.js'
import { getCompoundCommandPrefixesStatic } from '../bash/prefix.js'
import { tryParseShellCommand } from '../bash/shellQuote.js'
import { isEnvDefinedFalsy, isEnvTruthy } from '../envUtils.js'
import { AbortError } from '../errors.js'
import { getSettingsForSource } from '../settings/settings.js'
import { permissionRuleValueFromString } from './permissionRuleParser.js'
import { matchWildcardPattern, parsePermissionRule } from './shellRuleMatching.js'

export const PROMPT_PREFIX = 'prompt:'

export type ClassifierResult = {
  matches: boolean
  matchedDescription?: string
  confidence: 'high' | 'medium' | 'low'
  reason: string
}

export type ClassifierBehavior = 'deny' | 'ask' | 'allow'

type DerivedCommandShape = {
  prefixes: string[]
  roots: string[]
  candidates: string[]
  vocabulary: Set<string>
}

type MatchEvaluation = {
  matches: boolean
  confidence: 'high' | 'medium' | 'low'
  reason: string
}

const PROMPT_PREFIX_RE = /^\s*prompt\s*:\s*(.+?)\s*$/i
const ENV_VAR_ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/
const GENERIC_TOKENS = new Set([
  'allow',
  'allowed',
  'allowing',
  'and',
  'bash',
  'command',
  'commands',
  'execute',
  'executing',
  'for',
  'run',
  'running',
  'shell',
  'the',
  'this',
  'use',
  'using',
  'with',
])

const ROOT_DESCRIPTION_ALIASES: Record<string, string[]> = {
  bash: ['run bash commands'],
  bun: ['run bun commands'],
  cat: ['read files', 'show file contents'],
  cd: ['change directories', 'navigate directories'],
  cp: ['copy files'],
  docker: ['run docker commands'],
  find: ['find files', 'search files'],
  git: ['run git commands'],
  grep: ['search text', 'find text'],
  kubectl: ['run kubernetes commands'],
  ls: ['list files', 'show directory contents'],
  mkdir: ['create directories'],
  mv: ['move files', 'rename files'],
  npm: ['run npm commands'],
  pnpm: ['run pnpm commands'],
  python: ['run python scripts'],
  rm: ['delete files', 'remove files'],
  sed: ['edit text', 'replace text'],
  touch: ['create files'],
  yarn: ['run yarn commands'],
}

const PREFIX_DESCRIPTION_ALIASES: Record<string, string[]> = {
  'bun install': ['install dependencies'],
  'bun run': ['run bun scripts'],
  'bun run build': ['build project'],
  'bun test': ['run tests'],
  'docker build': ['build docker images'],
  'docker compose': ['manage docker compose'],
  'docker ps': ['list docker containers'],
  'git add': ['stage git changes'],
  'git branch': ['manage git branches'],
  'git checkout': ['switch git branches', 'restore git files'],
  'git commit': ['commit changes', 'create git commits'],
  'git diff': ['inspect git changes', 'view git diff'],
  'git fetch': ['fetch git changes', 'update git references'],
  'git pull': ['pull git changes', 'update git branch'],
  'git push': ['push git changes'],
  'git status': ['check git status'],
  'kubectl apply': ['apply kubernetes manifests'],
  'kubectl get': ['inspect kubernetes resources', 'list kubernetes resources'],
  'npm install': ['install dependencies', 'install npm dependencies'],
  'npm run': ['run npm scripts'],
  'npm run build': ['build project'],
  'npm run lint': ['lint project', 'run lint'],
  'npm run test': ['run tests'],
  'npm test': ['run tests', 'run npm tests'],
  'pip install': ['install dependencies', 'install python packages'],
  'pnpm install': ['install dependencies'],
  'pnpm test': ['run tests'],
  'python manage.py migrate': [
    'migrate database',
    'run database migrations',
  ],
  'yarn install': ['install dependencies'],
  'yarn test': ['run tests'],
}

const commandShapeCache = new Map<string, Promise<DerivedCommandShape>>()

export function extractPromptDescription(
  ruleContent: string | undefined,
): string | null {
  if (!ruleContent) {
    return null
  }

  const match = ruleContent.match(PROMPT_PREFIX_RE)
  if (!match?.[1]) {
    return null
  }

  const description = normalizeDescription(match[1])
  return description.length > 0 ? description : null
}

export function createPromptRuleContent(description: string): string {
  return `${PROMPT_PREFIX} ${description.trim()}`
}

export function isClassifierPermissionsEnabled(): boolean {
  if (isEnvDefinedFalsy(process.env.CLAUDE_CODE_BASH_CLASSIFIER)) {
    return false
  }
  if (isEnvTruthy(process.env.CLAUDE_CODE_BASH_CLASSIFIER)) {
    return true
  }

  let enabled = false
  for (const source of [
    'userSettings',
    'localSettings',
    'flagSettings',
    'policySettings',
  ] as const) {
    const value = getSettingsForSource(source)?.classifierPermissionsEnabled
    if (typeof value === 'boolean') {
      enabled = value
    }
  }
  return enabled
}

export function getBashPromptDenyDescriptions(
  context: ToolPermissionContext,
): string[] {
  return collectPromptDescriptions(context.alwaysDenyRules)
}

export function getBashPromptAskDescriptions(
  context: ToolPermissionContext,
): string[] {
  return collectPromptDescriptions(context.alwaysAskRules)
}

export function getBashPromptAllowDescriptions(
  context: ToolPermissionContext,
): string[] {
  return collectPromptDescriptions(context.alwaysAllowRules)
}

export async function classifyBashCommand(
  command: string,
  _cwd: string,
  descriptions: string[],
  _behavior: ClassifierBehavior,
  signal: AbortSignal,
  _isNonInteractiveSession: boolean,
): Promise<ClassifierResult> {
  assertNotAborted(signal)

  if (!isClassifierPermissionsEnabled()) {
    return {
      matches: false,
      confidence: 'high',
      reason: 'Bash classifier permissions are disabled',
    }
  }

  const normalizedDescriptions = descriptions
    .map(description => normalizeDescription(description))
    .filter(Boolean)

  if (normalizedDescriptions.length === 0) {
    return {
      matches: false,
      confidence: 'low',
      reason: 'No Bash prompt rules available to match against',
    }
  }

  const commandShape = await getDerivedCommandShape(command)
  assertNotAborted(signal)

  if (commandShape.candidates.length === 0 && commandShape.prefixes.length === 0) {
    return {
      matches: false,
      confidence: 'low',
      reason: 'Could not derive a stable command shape for classifier matching',
    }
  }

  let bestMatch:
    | {
        description: string
        evaluation: MatchEvaluation
      }
    | undefined

  for (const description of normalizedDescriptions) {
    const evaluation = evaluateDescription(command, description, commandShape)
    if (!evaluation.matches) {
      continue
    }

    if (
      !bestMatch ||
      confidenceRank(evaluation.confidence) >
        confidenceRank(bestMatch.evaluation.confidence)
    ) {
      bestMatch = {
        description,
        evaluation,
      }
    }

    if (evaluation.confidence === 'high') {
      break
    }
  }

  if (!bestMatch) {
    return {
      matches: false,
      confidence: 'low',
      reason:
        commandShape.prefixes.length > 0
          ? `No prompt rule matched derived command prefixes: ${commandShape.prefixes.join(', ')}`
          : 'No prompt rule matched the command',
    }
  }

  return {
    matches: true,
    matchedDescription: bestMatch.description,
    confidence: bestMatch.evaluation.confidence,
    reason: bestMatch.evaluation.reason,
  }
}

export async function generateGenericDescription(
  command: string,
  specificDescription: string | undefined,
  signal: AbortSignal,
): Promise<string | null> {
  assertNotAborted(signal)

  const normalizedSpecific = normalizeDescription(
    extractPromptDescription(specificDescription) ?? specificDescription ?? '',
  )
  if (normalizedSpecific.length > 0) {
    return normalizedSpecific
  }

  const commandShape = await getDerivedCommandShape(command)
  assertNotAborted(signal)

  if (commandShape.prefixes.length === 0) {
    return null
  }

  for (const prefix of commandShape.prefixes) {
    const alias = getAliasDescriptions(prefix)[0]
    if (alias) {
      return alias
    }
  }

  if (commandShape.prefixes.length === 1) {
    return `run ${commandShape.prefixes[0]} commands`
  }

  if (commandShape.roots.length === 1) {
    return `run ${commandShape.roots[0]} commands`
  }

  if (commandShape.roots.length === 2) {
    return `run ${commandShape.roots[0]} and ${commandShape.roots[1]} commands`
  }

  return null
}

function collectPromptDescriptions(
  rulesBySource: ToolPermissionRulesBySource,
): string[] {
  const descriptions: string[] = []
  const seen = new Set<string>()

  for (const rules of Object.values(rulesBySource)) {
    for (const rawRule of rules ?? []) {
      const parsed = permissionRuleValueFromString(rawRule)
      if (parsed.toolName !== BASH_TOOL_NAME) {
        continue
      }

      const description = extractPromptDescription(parsed.ruleContent)
      if (!description) {
        continue
      }

      const key = normalizeComparableText(description)
      if (key.length === 0 || seen.has(key)) {
        continue
      }

      seen.add(key)
      descriptions.push(description)
    }
  }

  return descriptions
}

function normalizeDescription(description: string): string {
  return description.replace(/\s+/g, ' ').trim()
}

function normalizeComparableText(text: string): string {
  return normalizeDescription(text).toLowerCase()
}

function tokenize(text: string): string[] {
  return normalizeComparableText(text)
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map(token => (token === 'commands' ? 'command' : token))
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new AbortError()
  }
}

function confidenceRank(confidence: ClassifierResult['confidence']): number {
  switch (confidence) {
    case 'high':
      return 3
    case 'medium':
      return 2
    case 'low':
      return 1
  }
}

function dedupePreservingOrder(values: string[]): string[] {
  const seen = new Set<string>()
  const deduped: string[] = []

  for (const value of values) {
    const trimmed = normalizeDescription(value)
    if (!trimmed) {
      continue
    }

    const key = normalizeComparableText(trimmed)
    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    deduped.push(trimmed)
  }

  return deduped
}

function getFallbackPrefixes(command: string): string[] {
  const parseResult = tryParseShellCommand(command)
  if (!parseResult.success || parseResult.tokens.length === 0) {
    const fallbackToken = command.trim().split(/\s+/).find(Boolean)
    return fallbackToken ? [normalizeDescription(fallbackToken)] : []
  }

  const tokens = parseResult.tokens
  const stringTokens: string[] = []
  for (const token of tokens) {
    if (typeof token !== 'string') {
      break
    }
    stringTokens.push(token)
  }

  let start = 0
  while (
    start < stringTokens.length &&
    ENV_VAR_ASSIGNMENT_RE.test(stringTokens[start]!)
  ) {
    start++
  }

  const remaining = stringTokens.slice(start).filter(Boolean)
  if (remaining.length === 0) {
    return []
  }

  const candidates: string[] = []
  const head = remaining[0]!
  const second = remaining[1]
  const third = remaining[2]

  if (
    second &&
    third &&
    /^[a-z0-9][a-z0-9._-]*$/i.test(third) &&
    (/\.[a-z0-9]+$/i.test(second) || second.includes('/'))
  ) {
    candidates.push(`${head} ${second} ${third}`)
  }

  if (second && /^[a-z0-9][a-z0-9._/-]*$/i.test(second)) {
    candidates.push(`${head} ${second}`)
  }

  candidates.push(head)
  return dedupePreservingOrder(candidates)
}

async function getDerivedCommandShape(command: string): Promise<DerivedCommandShape> {
  const cached = commandShapeCache.get(command)
  if (cached) {
    return cached
  }

  const promise = deriveCommandShape(command).catch(error => {
    commandShapeCache.delete(command)
    throw error
  })
  commandShapeCache.set(command, promise)
  return promise
}

async function deriveCommandShape(command: string): Promise<DerivedCommandShape> {
  const resolvedPrefixes = dedupePreservingOrder([
    ...(await getCompoundCommandPrefixesStatic(command)),
    ...getFallbackPrefixes(command),
  ])
  const roots = dedupePreservingOrder(
    resolvedPrefixes
      .map(prefix => prefix.split(' ')[0] ?? '')
      .filter(Boolean),
  )

  const candidates = dedupePreservingOrder([
    ...resolvedPrefixes,
    ...roots,
    ...resolvedPrefixes.flatMap(prefix => [
      `run ${prefix} command`,
      `run ${prefix} commands`,
      `${prefix} command`,
      `${prefix} commands`,
      ...getAliasDescriptions(prefix),
    ]),
    ...roots.flatMap(root => [
      `run ${root} command`,
      `run ${root} commands`,
      `${root} command`,
      `${root} commands`,
      ...(ROOT_DESCRIPTION_ALIASES[root] ?? []),
    ]),
  ])

  const vocabulary = new Set<string>()
  for (const candidate of candidates) {
    for (const token of tokenize(candidate)) {
      vocabulary.add(token)
    }
  }

  return {
    prefixes: resolvedPrefixes,
    roots,
    candidates,
    vocabulary,
  }
}

function getAliasDescriptions(prefix: string): string[] {
  const normalizedPrefix = normalizeComparableText(prefix)
  return dedupePreservingOrder([
    ...(PREFIX_DESCRIPTION_ALIASES[normalizedPrefix] ?? []),
    ...(ROOT_DESCRIPTION_ALIASES[normalizedPrefix.split(' ')[0] ?? ''] ?? []),
  ])
}

function evaluateDescription(
  command: string,
  description: string,
  commandShape: DerivedCommandShape,
): MatchEvaluation {
  const directRuleMatch = evaluateAsDirectShellRule(
    description,
    command,
    commandShape.prefixes,
  )
  if (directRuleMatch) {
    return directRuleMatch
  }

  const normalizedDescription = normalizeComparableText(description)
  const descriptionTokens = dedupePreservingOrder(tokenize(description))
  const meaningfulDescriptionTokens = descriptionTokens.filter(
    token => !GENERIC_TOKENS.has(token),
  )

  if (meaningfulDescriptionTokens.length === 0) {
    return {
      matches: false,
      confidence: 'low',
      reason: 'Prompt rule is too generic to classify safely',
    }
  }

  let best: MatchEvaluation = {
    matches: false,
    confidence: 'low',
    reason: 'Prompt rule did not match the command description',
  }

  for (const candidate of commandShape.candidates) {
    const normalizedCandidate = normalizeComparableText(candidate)
    if (normalizedCandidate === normalizedDescription) {
      return {
        matches: true,
        confidence: 'high',
        reason: `Matched derived command description "${candidate}" exactly`,
      }
    }

    const candidateTokens = tokenize(candidate)
    if (
      !meaningfulDescriptionTokens.some(token => commandShape.vocabulary.has(token))
    ) {
      continue
    }

    const matchesAllTokens = meaningfulDescriptionTokens.every(token =>
      candidateTokens.includes(token),
    )
    if (!matchesAllTokens) {
      continue
    }

    const ordered = isOrderedSubset(meaningfulDescriptionTokens, candidateTokens)
    const isBroadButAnchored =
      meaningfulDescriptionTokens.length >= 1 &&
      meaningfulDescriptionTokens.length < candidateTokens.length

    if (ordered && (meaningfulDescriptionTokens.length >= 2 || isBroadButAnchored)) {
      return {
        matches: true,
        confidence: 'high',
        reason: `Matched prompt keywords against derived command description "${candidate}"`,
      }
    }

    best = {
      matches: true,
      confidence: 'medium',
      reason: `Partially matched prompt keywords against "${candidate}"`,
    }
  }

  return best
}

function evaluateAsDirectShellRule(
  description: string,
  command: string,
  prefixes: string[],
): MatchEvaluation | null {
  const parsed = parsePermissionRule(description)
  const normalizedCommand = normalizeComparableText(command)
  const normalizedPrefixes = prefixes.map(normalizeComparableText)

  switch (parsed.type) {
    case 'exact': {
      const exact = normalizeComparableText(parsed.command)
      if (
        exact === normalizedCommand ||
        normalizedPrefixes.includes(exact) ||
        normalizedPrefixes.some(prefix => prefix.startsWith(`${exact} `))
      ) {
        return {
          matches: true,
          confidence: 'high',
          reason: `Matched direct Bash rule "${description}"`,
        }
      }
      return null
    }
    case 'prefix': {
      const prefix = normalizeComparableText(parsed.prefix)
      if (
        normalizedCommand === prefix ||
        normalizedCommand.startsWith(`${prefix} `) ||
        normalizedPrefixes.includes(prefix) ||
        normalizedPrefixes.some(candidate => candidate.startsWith(`${prefix} `))
      ) {
        return {
          matches: true,
          confidence: 'high',
          reason: `Matched command prefix rule "${description}"`,
        }
      }
      return null
    }
    case 'wildcard': {
      if (
        matchWildcardPattern(parsed.pattern, command, true) ||
        prefixes.some(prefix => matchWildcardPattern(parsed.pattern, prefix, true))
      ) {
        return {
          matches: true,
          confidence: 'high',
          reason: `Matched wildcard Bash rule "${description}"`,
        }
      }
      return null
    }
  }
}

function isOrderedSubset(needles: string[], haystack: string[]): boolean {
  let index = 0
  for (const token of haystack) {
    if (token === needles[index]) {
      index++
      if (index === needles.length) {
        return true
      }
    }
  }
  return needles.length === 0
}
