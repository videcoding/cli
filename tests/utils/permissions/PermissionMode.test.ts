import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { PermissionMode } from '../../../src/utils/permissions/PermissionMode.ts'
import {
  externalPermissionModeSchema,
  getModeColor,
  isDefaultMode,
  isExternalPermissionMode,
  permissionModeFromString,
  permissionModeSchema,
  permissionModeShortTitle,
  permissionModeSymbol,
  permissionModeTitle,
  toExternalPermissionMode,
} from '../../../src/utils/permissions/PermissionMode.ts'

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

beforeEach(restoreEnv)
afterEach(restoreEnv)

describe('PermissionMode', () => {
  test('parses permission mode strings and schema values', () => {
    expect(permissionModeSchema().safeParse('default').success).toBe(true)
    expect(permissionModeSchema().safeParse('missing').success).toBe(false)
    expect(externalPermissionModeSchema().safeParse('plan').success).toBe(true)
    expect(externalPermissionModeSchema().safeParse('bubble').success).toBe(
      false,
    )

    expect(permissionModeFromString('plan')).toBe('plan')
    expect(permissionModeFromString('not-a-mode')).toBe('default')
  })

  test('maps permission modes to titles, symbols, colors, and external values', () => {
    expect(permissionModeTitle('default')).toBe('Default')
    expect(permissionModeShortTitle('plan')).toBe('Plan')
    expect(permissionModeSymbol('plan')).not.toBe('')
    expect(getModeColor('bypassPermissions')).toBe('error')
    expect(toExternalPermissionMode('acceptEdits')).toBe('acceptEdits')
    expect(toExternalPermissionMode('plan')).toBe('plan')
  })

  test('detects default mode and external mode eligibility by user type', () => {
    expect(isDefaultMode(undefined)).toBe(true)
    expect(isDefaultMode('default')).toBe(true)
    expect(isDefaultMode('plan')).toBe(false)

    process.env.USER_TYPE = 'external'
    expect(isExternalPermissionMode('auto' as PermissionMode)).toBe(true)

    process.env.USER_TYPE = 'ant'
    expect(isExternalPermissionMode('plan')).toBe(true)
    expect(isExternalPermissionMode('auto' as PermissionMode)).toBe(false)
    expect(isExternalPermissionMode('bubble' as PermissionMode)).toBe(false)
  })
})
