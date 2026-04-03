import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { env, getGlobalClaudeFile, getHostPlatformForAnalytics } from '../../src/utils/env.ts'
import {
  NodeFsOperations,
  setFsImplementation,
  setOriginalFsImplementation,
} from '../../src/utils/fsOperations.ts'

const originalEnv = { ...process.env }
const tempDirs: string[] = []
const terminalEnvKeys = [
  'CURSOR_TRACE_ID',
  'VSCODE_GIT_ASKPASS_MAIN',
  '__CFBundleIdentifier',
  'VisualStudioVersion',
  'TERMINAL_EMULATOR',
  'TERM',
  'TERM_PROGRAM',
  'TMUX',
  'STY',
  'KONSOLE_VERSION',
  'GNOME_TERMINAL_SERVICE',
  'XTERM_VERSION',
  'VTE_VERSION',
  'TERMINATOR_UUID',
  'KITTY_WINDOW_ID',
  'ALACRITTY_LOG',
  'TILIX_ID',
  'WT_SESSION',
  'SESSIONNAME',
  'MSYSTEM',
  'ConEmuANSI',
  'ConEmuPID',
  'ConEmuTask',
  'WSL_DISTRO_NAME',
  'SSH_CONNECTION',
  'SSH_CLIENT',
  'SSH_TTY',
] as const

const deploymentEnvKeys = [
  'CODESPACES',
  'GITPOD_WORKSPACE_ID',
  'REPL_ID',
  'REPL_SLUG',
  'PROJECT_DOMAIN',
  'VERCEL',
  'RAILWAY_ENVIRONMENT_NAME',
  'RAILWAY_SERVICE_NAME',
  'RENDER',
  'NETLIFY',
  'DYNO',
  'FLY_APP_NAME',
  'FLY_MACHINE_ID',
  'CF_PAGES',
  'DENO_DEPLOYMENT_ID',
  'AWS_LAMBDA_FUNCTION_NAME',
  'AWS_EXECUTION_ENV',
  'K_SERVICE',
  'GOOGLE_CLOUD_PROJECT',
  'WEBSITE_SITE_NAME',
  'WEBSITE_SKU',
  'AZURE_FUNCTIONS_ENVIRONMENT',
  'APP_URL',
  'SPACE_CREATOR_USER_ID',
  'GITHUB_ACTIONS',
  'GITLAB_CI',
  'CIRCLECI',
  'BUILDKITE',
  'CI',
  'KUBERNETES_SERVICE_HOST',
] as const

const envModuleUrl = new URL('../../src/utils/env.ts', import.meta.url).href

type MemoizedFn = ((...args: never[]) => unknown) & {
  cache?: { clear?: () => void }
}

function clearMemoized(fn: unknown) {
  ;(fn as MemoizedFn).cache?.clear?.()
}

function restoreProcessState() {
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

function resetEnvModuleState() {
  clearMemoized(getGlobalClaudeFile)
  clearMemoized(env.detectDeploymentEnvironment)
  clearMemoized(env.getPackageManagers)
  clearMemoized(env.getRuntimes)
  clearMemoized(env.isWslEnvironment)
  clearMemoized(env.isNpmFromWindowsPath)
  clearMemoized(env.hasInternetAccess)
  clearMemoized(env.isRunningWithBun)
}

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'videcoding-cli-env-'))
  tempDirs.push(dir)
  return dir
}

function makeExecutable(dir: string, name: string): string {
  const file = join(dir, name)
  writeFileSync(file, '#!/bin/sh\nexit 0\n')
  chmodSync(file, 0o755)
  return file
}

function clearTerminalEnv() {
  for (const key of terminalEnvKeys) {
    delete process.env[key]
  }
}

function clearDeploymentEnv() {
  for (const key of deploymentEnvKeys) {
    delete process.env[key]
  }
}

function evaluateEnvModuleInSubprocess(
  envOverrides: Record<string, string | undefined>,
) {
  const childEnv: Record<string, string> = {}

  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      childEnv[key] = value
    }
  }
  for (const key of terminalEnvKeys) {
    delete childEnv[key]
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
      `const mod = await import(${JSON.stringify(envModuleUrl)}); process.stdout.write(JSON.stringify({ terminal: mod.env.terminal }))`,
    ],
    env: childEnv,
    stdout: 'pipe',
    stderr: 'pipe',
  })

  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString())
  }

  return JSON.parse(result.stdout.toString()) as { terminal: string | null }
}

beforeEach(() => {
  restoreProcessState()
  setOriginalFsImplementation()
  resetEnvModuleState()
})

afterEach(() => {
  restoreProcessState()
  setOriginalFsImplementation()
  resetEnvModuleState()
  mock.restore()
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('env', () => {
  test('prefers legacy config files and derives oauth-specific config names', () => {
    const configDir = makeTempDir()
    const legacyConfig = join(configDir, '.config.json')
    process.env.CLAUDE_CONFIG_DIR = configDir

    writeFileSync(legacyConfig, '{}')
    expect(getGlobalClaudeFile()).toBe(legacyConfig)

    rmSync(legacyConfig)
    resetEnvModuleState()

    process.env.USER_TYPE = 'ant'
    process.env.USE_STAGING_OAUTH = '1'
    expect(getGlobalClaudeFile()).toBe(
      join(configDir, '.claude-staging-oauth.json'),
    )

    process.env.CLAUDE_CODE_CUSTOM_OAUTH_URL =
      'https://claude.fedstart.com/'
    resetEnvModuleState()
    expect(getGlobalClaudeFile()).toBe(
      join(configDir, '.claude-custom-oauth.json'),
    )
  })

  test('detects package managers and runtimes from PATH', async () => {
    const binDir = makeTempDir()
    process.env.PATH = binDir

    makeExecutable(binDir, 'npm')
    makeExecutable(binDir, 'pnpm')
    makeExecutable(binDir, 'bun')
    makeExecutable(binDir, 'node')

    const packageManagers = await env.getPackageManagers()
    const runtimes = await env.getRuntimes()

    expect(packageManagers).toContain('npm')
    expect(packageManagers).toContain('pnpm')
    expect(runtimes).toContain('bun')
    expect(runtimes).toContain('node')
  })

  test('detects deployment environments from env vars and docker markers', () => {
    process.env.CODESPACES = '1'
    expect(env.detectDeploymentEnvironment()).toBe('codespaces')

    restoreProcessState()
    resetEnvModuleState()
    process.env.AWS_LAMBDA_FUNCTION_NAME = 'handler'
    expect(env.detectDeploymentEnvironment()).toBe('aws-lambda')

    restoreProcessState()
    resetEnvModuleState()
    setFsImplementation({
      ...NodeFsOperations,
      existsSync(path) {
        return path === '/.dockerenv'
      },
      readFileSync() {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      },
    })
    expect(env.detectDeploymentEnvironment()).toBe('docker')
  })

  test('reports WSL, conductor, bun, and host platform overrides', () => {
    setFsImplementation({
      ...NodeFsOperations,
      existsSync(path) {
        return path === '/proc/sys/fs/binfmt_misc/WSLInterop'
      },
    })

    expect(env.isWslEnvironment()).toBe(true)

    process.env.__CFBundleIdentifier = 'com.conductor.app'
    expect(env.isConductor()).toBe(true)
    expect(env.isRunningWithBun()).toBe(true)

    process.env.CLAUDE_CODE_HOST_PLATFORM = 'win32'
    expect(getHostPlatformForAnalytics()).toBe('win32')

    process.env.CLAUDE_CODE_HOST_PLATFORM = 'invalid'
    expect(getHostPlatformForAnalytics()).toBe(env.platform)
  })

  test('detects SSH sessions from all supported environment variables', () => {
    expect(env.isSSH()).toBe(false)

    process.env.SSH_CLIENT = '127.0.0.1 22 22'
    expect(env.isSSH()).toBe(true)

    delete process.env.SSH_CLIENT
    process.env.SSH_TTY = '/dev/ttys001'
    expect(env.isSSH()).toBe(true)
  })

  test('returns false when WSL probing throws', () => {
    setFsImplementation({
      ...NodeFsOperations,
      existsSync(path) {
        if (path === '/proc/sys/fs/binfmt_misc/WSLInterop') {
          throw new Error('wsl probe failed')
        }
        return false
      },
    })

    expect(env.isWslEnvironment()).toBe(false)
  })

  test('detects internet availability from axios success and failure', async () => {
    const axiosState = { online: true }

    mock.module('axios', () => ({
      default: {
        head: async () => {
          if (!axiosState.online) {
            throw new Error('offline')
          }
        },
      },
    }))

    expect(await env.hasInternetAccess()).toBe(true)

    axiosState.online = false
    resetEnvModuleState()
    expect(await env.hasInternetAccess()).toBe(false)
  })

  test('detects terminal families from environment at module load', async () => {
    expect(
      evaluateEnvModuleInSubprocess({ CURSOR_TRACE_ID: 'trace' }).terminal,
    ).toBe('cursor')
    expect(
      evaluateEnvModuleInSubprocess({
        VSCODE_GIT_ASKPASS_MAIN: '/applications/cursor.app/bin',
      }).terminal,
    ).toBe('cursor')
    expect(
      evaluateEnvModuleInSubprocess({
        VSCODE_GIT_ASKPASS_MAIN: '/applications/windsurf.app/bin',
      }).terminal,
    ).toBe('windsurf')
    expect(
      evaluateEnvModuleInSubprocess({
        __CFBundleIdentifier: 'com.google.android.studio',
      }).terminal,
    ).toBe('androidstudio')
    expect(
      evaluateEnvModuleInSubprocess({
        __CFBundleIdentifier: 'com.jetbrains.intellij',
      }).terminal,
    ).toBe('intellij')
    expect(
      evaluateEnvModuleInSubprocess({
        TERMINAL_EMULATOR: 'JetBrains-JediTerm',
      }).terminal,
    ).toBe('pycharm')
    expect(
      evaluateEnvModuleInSubprocess({ TERM: 'xterm-ghostty' }).terminal,
    ).toBe('ghostty')
    expect(evaluateEnvModuleInSubprocess({ TMUX: '1' }).terminal).toBe('tmux')
    expect(
      evaluateEnvModuleInSubprocess({ SSH_CONNECTION: 'a b c d' }).terminal,
    ).toBe('ssh-session')
  })

  test('detects additional terminal fallbacks and non-interactive shells', async () => {
    expect(
      evaluateEnvModuleInSubprocess({
        VSCODE_GIT_ASKPASS_MAIN: '/applications/antigravity.app/bin',
      }).terminal,
    ).toBe('antigravity')
    expect(
      evaluateEnvModuleInSubprocess({
        __CFBundleIdentifier: 'com.vscodium.VSCodium',
      }).terminal,
    ).toBe('codium')
    expect(
      evaluateEnvModuleInSubprocess({
        __CFBundleIdentifier: 'com.windsurf.desktop',
      }).terminal,
    ).toBe('windsurf')
    expect(
      evaluateEnvModuleInSubprocess({ VisualStudioVersion: '17.0' }).terminal,
    ).toBe('visualstudio')
    expect(
      evaluateEnvModuleInSubprocess({ TERM: 'xterm-kitty' }).terminal,
    ).toBe('kitty')
    expect(
      evaluateEnvModuleInSubprocess({ TERM_PROGRAM: 'WezTerm' }).terminal,
    ).toBe('WezTerm')
    expect(evaluateEnvModuleInSubprocess({ STY: '123' }).terminal).toBe('screen')
    expect(
      evaluateEnvModuleInSubprocess({ KONSOLE_VERSION: '230000' }).terminal,
    ).toBe('konsole')
    expect(
      evaluateEnvModuleInSubprocess({
        GNOME_TERMINAL_SERVICE: '/org/gnome/Terminal/screen',
      }).terminal,
    ).toBe('gnome-terminal')
    expect(
      evaluateEnvModuleInSubprocess({ XTERM_VERSION: 'XTerm(390)' }).terminal,
    ).toBe('xterm')
    expect(
      evaluateEnvModuleInSubprocess({ VTE_VERSION: '7003' }).terminal,
    ).toBe('vte-based')
    expect(
      evaluateEnvModuleInSubprocess({
        TERMINATOR_UUID: 'urn:uuid:test',
      }).terminal,
    ).toBe('terminator')
    expect(
      evaluateEnvModuleInSubprocess({ KITTY_WINDOW_ID: '7' }).terminal,
    ).toBe('kitty')
    expect(
      evaluateEnvModuleInSubprocess({ ALACRITTY_LOG: '/tmp/alacritty.log' })
        .terminal,
    ).toBe('alacritty')
    expect(evaluateEnvModuleInSubprocess({ TILIX_ID: '42' }).terminal).toBe(
      'tilix',
    )
    expect(evaluateEnvModuleInSubprocess({ WT_SESSION: '1' }).terminal).toBe(
      'windows-terminal',
    )
    expect(
      evaluateEnvModuleInSubprocess({
        SESSIONNAME: 'Console',
        TERM: 'cygwin',
      }).terminal,
    ).toBe('cygwin')
    expect(evaluateEnvModuleInSubprocess({ MSYSTEM: 'MINGW64' }).terminal).toBe(
      'mingw64',
    )
    expect(
      evaluateEnvModuleInSubprocess({ ConEmuANSI: 'ON' }).terminal,
    ).toBe('conemu')
    expect(
      evaluateEnvModuleInSubprocess({ WSL_DISTRO_NAME: 'Ubuntu-24.04' })
        .terminal,
    ).toBe('wsl-Ubuntu-24.04')
    expect(
      evaluateEnvModuleInSubprocess({ TERM: 'rxvt-unicode-256color' }).terminal,
    ).toBe('rxvt')
    expect(
      evaluateEnvModuleInSubprocess({ TERM: 'termite-direct' }).terminal,
    ).toBe('termite')
    expect(
      evaluateEnvModuleInSubprocess({ TERM: 'xterm-256color' }).terminal,
    ).toBe('xterm-256color')
    expect(evaluateEnvModuleInSubprocess({}).terminal).toBe('non-interactive')
  })

  test('detects more deployment environments, EC2 markers, and unknown fallbacks', () => {
    const fsWithoutMarkers = {
      ...NodeFsOperations,
      existsSync() {
        return false
      },
      readFileSync() {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      },
    }
    const cases = [
      [{ GITPOD_WORKSPACE_ID: 'workspace' }, 'gitpod'],
      [{ REPL_SLUG: 'repl' }, 'replit'],
      [{ PROJECT_DOMAIN: 'glitch-project' }, 'glitch'],
      [{ VERCEL: '1' }, 'vercel'],
      [{ RAILWAY_ENVIRONMENT_NAME: 'production' }, 'railway'],
      [{ RAILWAY_SERVICE_NAME: 'api' }, 'railway'],
      [{ RENDER: 'true' }, 'render'],
      [{ NETLIFY: 'true' }, 'netlify'],
      [{ DYNO: 'web.1' }, 'heroku'],
      [{ FLY_APP_NAME: 'fly-app' }, 'fly.io'],
      [{ FLY_MACHINE_ID: 'machine-id' }, 'fly.io'],
      [{ CF_PAGES: '1' }, 'cloudflare-pages'],
      [{ DENO_DEPLOYMENT_ID: 'deploy-id' }, 'deno-deploy'],
      [{ AWS_EXECUTION_ENV: 'AWS_ECS_FARGATE' }, 'aws-fargate'],
      [{ AWS_EXECUTION_ENV: 'AWS_ECS_EC2' }, 'aws-ecs'],
      [{ GITHUB_ACTIONS: 'true' }, 'github-actions'],
      [{ GITLAB_CI: 'true' }, 'gitlab-ci'],
      [{ CIRCLECI: 'true' }, 'circleci'],
      [{ BUILDKITE: 'true' }, 'buildkite'],
      [{ KUBERNETES_SERVICE_HOST: '10.0.0.1' }, 'kubernetes'],
      [{ CI: '1' }, 'ci'],
      [{ APP_URL: 'https://demo.ondigitalocean.app' }, 'digitalocean-app-platform'],
      [{ SPACE_CREATOR_USER_ID: 'hf-user' }, 'huggingface-spaces'],
      [{ K_SERVICE: 'svc' }, 'gcp-cloud-run'],
      [{ GOOGLE_CLOUD_PROJECT: 'project' }, 'gcp'],
      [{ WEBSITE_SITE_NAME: 'webapp' }, 'azure-app-service'],
      [{ WEBSITE_SKU: 'Basic' }, 'azure-app-service'],
      [{ AZURE_FUNCTIONS_ENVIRONMENT: 'Production' }, 'azure-functions'],
    ] as const

    for (const [overrides, expected] of cases) {
      restoreProcessState()
      clearDeploymentEnv()
      resetEnvModuleState()
      setFsImplementation(fsWithoutMarkers)
      for (const [key, value] of Object.entries(overrides)) {
        process.env[key] = value
      }
      expect(env.detectDeploymentEnvironment()).toBe(expected)
    }

    restoreProcessState()
    clearDeploymentEnv()
    resetEnvModuleState()
    setFsImplementation({
      ...NodeFsOperations,
      existsSync() {
        return false
      },
      readFileSync(path) {
        if (path === '/sys/hypervisor/uuid') {
          return 'ec2abcd'
        }
        throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      },
    })
    expect(env.detectDeploymentEnvironment()).toBe('aws-ec2')

    restoreProcessState()
    clearDeploymentEnv()
    resetEnvModuleState()
    setFsImplementation(fsWithoutMarkers)
    expect(env.detectDeploymentEnvironment()).toBe(`unknown-${env.platform}`)

    restoreProcessState()
    clearDeploymentEnv()
    resetEnvModuleState()
    setFsImplementation({
      ...NodeFsOperations,
      existsSync() {
        throw new Error('docker probe failed')
      },
      readFileSync() {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      },
    })
    expect(env.detectDeploymentEnvironment()).toBe(`unknown-${env.platform}`)
  })
})
