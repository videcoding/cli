import { afterEach, describe, expect, test } from 'bun:test'
import {
  isInBundledMode,
  isRunningWithBun,
} from '../../src/utils/bundledMode.ts'

const originalVersions = process.versions
const originalEmbeddedFiles = Bun.embeddedFiles

afterEach(() => {
  Object.defineProperty(process, 'versions', {
    configurable: true,
    enumerable: true,
    value: originalVersions,
    writable: true,
  })
  Bun.embeddedFiles = originalEmbeddedFiles
})

describe('bundledMode', () => {
  test('detects Bun from process.versions.bun', () => {
    Object.defineProperty(process, 'versions', {
      configurable: true,
      enumerable: true,
      value: { node: process.versions.node } satisfies Partial<NodeJS.ProcessVersions>,
      writable: true,
    })
    expect(isRunningWithBun()).toBe(false)

    Object.defineProperty(process, 'versions', {
      configurable: true,
      enumerable: true,
      value: {
        node: process.versions.node,
        bun: '1.0.0',
      } satisfies Partial<NodeJS.ProcessVersions>,
      writable: true,
    })
    expect(isRunningWithBun()).toBe(true)
  })

  test('detects bundled mode from embedded files', () => {
    Bun.embeddedFiles = []
    expect(isInBundledMode()).toBe(false)

    Bun.embeddedFiles = [{}] as never
    expect(isInBundledMode()).toBe(true)
  })
})
