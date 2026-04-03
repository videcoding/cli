import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import {
  getAWSRegion,
  getClaudeConfigHomeDir,
  getDefaultVertexRegion,
  getTeamsDir,
  getVertexRegionForModel,
  hasNodeOption,
  isBareMode,
  isEnvDefinedFalsy,
  isEnvTruthy,
  isRunningOnHomespace,
  parseEnvVars,
  shouldMaintainProjectWorkingDir,
} from '../../src/utils/envUtils.ts'

const originalEnv = { ...process.env }
const originalArgv = [...process.argv]

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
  process.argv.splice(0, process.argv.length, ...originalArgv)
}

beforeEach(() => {
  restoreProcessState()
})

afterEach(() => {
  restoreProcessState()
})

describe('envUtils', () => {
  test('resolves config directories from env and derives teams path', () => {
    process.env.CLAUDE_CONFIG_DIR = '/tmp/custom-config'
    expect(getClaudeConfigHomeDir()).toBe('/tmp/custom-config')
    expect(getTeamsDir()).toBe(join('/tmp/custom-config', 'teams'))
  })

  test('checks node options by exact token match', () => {
    process.env.NODE_OPTIONS = '--max-old-space-size=8192 --trace-warnings'
    expect(hasNodeOption('--trace-warnings')).toBe(true)
    expect(hasNodeOption('--trace')).toBe(false)
  })

  test('interprets truthy and falsy environment values', () => {
    expect(isEnvTruthy(' YES ')).toBe(true)
    expect(isEnvTruthy(true)).toBe(true)
    expect(isEnvTruthy('0')).toBe(false)
    expect(isEnvDefinedFalsy(' off ')).toBe(true)
    expect(isEnvDefinedFalsy(false)).toBe(true)
    expect(isEnvDefinedFalsy(undefined)).toBe(false)
  })

  test('detects bare mode from env vars and argv', () => {
    expect(isBareMode()).toBe(false)
    process.env.CLAUDE_CODE_SIMPLE = '1'
    expect(isBareMode()).toBe(true)

    delete process.env.CLAUDE_CODE_SIMPLE
    process.argv.push('--bare')
    expect(isBareMode()).toBe(true)
  })

  test('parses env var arguments and rejects malformed entries', () => {
    expect(parseEnvVars(['FOO=bar', 'A=b=c'])).toEqual({
      FOO: 'bar',
      A: 'b=c',
    })
    expect(() => parseEnvVars(['BROKEN'])).toThrow(
      'Invalid environment variable format: BROKEN',
    )
  })

  test('resolves AWS and Vertex regions with expected fallbacks', () => {
    delete process.env.AWS_REGION
    delete process.env.AWS_DEFAULT_REGION
    expect(getAWSRegion()).toBe('us-east-1')

    process.env.AWS_DEFAULT_REGION = 'ap-southeast-1'
    expect(getAWSRegion()).toBe('ap-southeast-1')

    delete process.env.CLOUD_ML_REGION
    expect(getDefaultVertexRegion()).toBe('us-east5')

    process.env.CLOUD_ML_REGION = 'europe-west4'
    process.env.VERTEX_REGION_CLAUDE_4_6_SONNET = 'us-central1'
    expect(getVertexRegionForModel('claude-sonnet-4-6-20250929')).toBe(
      'us-central1',
    )
    expect(getVertexRegionForModel('unknown-model')).toBe('europe-west4')
    expect(getVertexRegionForModel(undefined)).toBe('europe-west4')
  })

  test('detects homespace and project working dir settings', () => {
    process.env.CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR = 'true'
    expect(shouldMaintainProjectWorkingDir()).toBe(true)

    process.env.USER_TYPE = 'ant'
    process.env.COO_RUNNING_ON_HOMESPACE = '1'
    expect(isRunningOnHomespace()).toBe(true)

    process.env.COO_RUNNING_ON_HOMESPACE = '0'
    expect(isRunningOnHomespace()).toBe(false)
  })
})
