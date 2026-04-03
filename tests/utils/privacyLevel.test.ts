import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  getEssentialTrafficOnlyReason,
  getPrivacyLevel,
  isEssentialTrafficOnly,
  isTelemetryDisabled,
} from '../../src/utils/privacyLevel.ts'

const originalEnv = { ...process.env }

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key]
  }
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

beforeEach(restoreEnv)
afterEach(restoreEnv)

describe('privacyLevel', () => {
  test('defaults to unrestricted mode', () => {
    delete process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC
    delete process.env.DISABLE_TELEMETRY

    expect(getPrivacyLevel()).toBe('default')
    expect(isEssentialTrafficOnly()).toBe(false)
    expect(isTelemetryDisabled()).toBe(false)
    expect(getEssentialTrafficOnlyReason()).toBeNull()
  })

  test('elevates to no-telemetry when telemetry is disabled', () => {
    process.env.DISABLE_TELEMETRY = '1'

    expect(getPrivacyLevel()).toBe('no-telemetry')
    expect(isEssentialTrafficOnly()).toBe(false)
    expect(isTelemetryDisabled()).toBe(true)
  })

  test('elevates to essential-traffic when nonessential traffic is disabled', () => {
    process.env.DISABLE_TELEMETRY = '1'
    process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'

    expect(getPrivacyLevel()).toBe('essential-traffic')
    expect(isEssentialTrafficOnly()).toBe(true)
    expect(isTelemetryDisabled()).toBe(true)
    expect(getEssentialTrafficOnlyReason()).toBe(
      'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
    )
  })
})
