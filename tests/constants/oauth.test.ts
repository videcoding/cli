import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

const originalEnv = { ...process.env }

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key]
    }
  }
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

async function loadFreshOauthModule() {
  const url = new URL('../../src/constants/oauth.ts', import.meta.url)
  return import(`${url.href}?case=${Date.now()}-${Math.random()}`)
}

function evaluateOauthConfigInSubprocess(
  envOverrides: Record<string, string | undefined>,
) {
  const moduleUrl = new URL('../../src/constants/oauth.ts', import.meta.url).href
  const childEnv: Record<string, string> = {}

  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      childEnv[key] = value
    }
  }
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) {
      delete childEnv[key]
    } else {
      childEnv[key] = value
    }
  }

  const result = Bun.spawnSync({
    cmd: [
      process.execPath,
      '-e',
      `const mod = await import(${JSON.stringify(moduleUrl)}); process.stdout.write(JSON.stringify({ suffix: mod.fileSuffixForOauthConfig(), config: mod.getOauthConfig() }))`,
    ],
    env: childEnv,
    stdout: 'pipe',
    stderr: 'pipe',
  })

  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString())
  }

  return JSON.parse(result.stdout.toString()) as {
    suffix: string
    config: { BASE_API_URL: string; CLAUDE_AI_AUTHORIZE_URL: string; OAUTH_FILE_SUFFIX: string }
  }
}

beforeEach(restoreEnv)
afterEach(restoreEnv)

describe('oauth constants', () => {
  test('defaults to production oauth config', async () => {
    const oauth = await loadFreshOauthModule()
    const config = oauth.getOauthConfig()

    expect(oauth.fileSuffixForOauthConfig()).toBe('')
    expect(config.BASE_API_URL).toBe('https://api.anthropic.com')
    expect(config.OAUTH_FILE_SUFFIX).toBe('')
    expect(config.CLIENT_ID).toBe('9d1c250a-e61b-44d9-88ed-5944d1962f5e')
  })

  test('supports local and staging oauth configs for ant users', async () => {
    process.env.USER_TYPE = 'ant'
    process.env.USE_LOCAL_OAUTH = '1'
    let oauth = await loadFreshOauthModule()
    let config = oauth.getOauthConfig()

    expect(oauth.fileSuffixForOauthConfig()).toBe('-local-oauth')
    expect(config.BASE_API_URL).toBe('http://localhost:8000')
    expect(config.CLAUDE_AI_AUTHORIZE_URL).toBe(
      'http://localhost:4000/oauth/authorize',
    )

    const staging = evaluateOauthConfigInSubprocess({
      USER_TYPE: 'ant',
      USE_LOCAL_OAUTH: undefined,
      USE_STAGING_OAUTH: '1',
    })

    expect(staging.suffix).toBe('-staging-oauth')
    expect(staging.config.BASE_API_URL).toBe(
      'https://api-staging.anthropic.com',
    )
    expect(staging.config.OAUTH_FILE_SUFFIX).toBe('-staging-oauth')
  })

  test('applies approved custom oauth endpoints and client id overrides', async () => {
    process.env.CLAUDE_CODE_CUSTOM_OAUTH_URL = 'https://claude.fedstart.com/'
    process.env.CLAUDE_CODE_OAUTH_CLIENT_ID = 'custom-client'
    const oauth = await loadFreshOauthModule()
    const config = oauth.getOauthConfig()

    expect(oauth.fileSuffixForOauthConfig()).toBe('-custom-oauth')
    expect(config.BASE_API_URL).toBe('https://claude.fedstart.com')
    expect(config.CLAUDE_AI_ORIGIN).toBe('https://claude.fedstart.com')
    expect(config.CLIENT_ID).toBe('custom-client')
  })

  test('rejects unapproved custom oauth endpoints', async () => {
    process.env.CLAUDE_CODE_CUSTOM_OAUTH_URL = 'https://evil.example.com'
    const oauth = await loadFreshOauthModule()

    expect(() => oauth.getOauthConfig()).toThrow(
      'CLAUDE_CODE_CUSTOM_OAUTH_URL is not an approved endpoint.',
    )
  })
})
