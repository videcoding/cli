import { describe, expect, test } from 'bun:test'
import { createBufferedWriter } from '../../src/utils/bufferedWriter.ts'

function waitForImmediate(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve))
}

describe('bufferedWriter', () => {
  test('writes immediately when immediateMode is enabled', () => {
    const writes: string[] = []
    const writer = createBufferedWriter({
      writeFn: content => {
        writes.push(content)
      },
      immediateMode: true,
    })

    writer.write('a')
    writer.write('b')

    expect(writes).toEqual(['a', 'b'])
  })

  test('flushes buffered content on the timer', async () => {
    const writes: string[] = []
    const writer = createBufferedWriter({
      writeFn: content => {
        writes.push(content)
      },
      flushIntervalMs: 10,
    })

    writer.write('hello')
    await Bun.sleep(20)

    expect(writes).toEqual(['hello'])
  })

  test('defers overflow writes and coalesces pending batches in order', async () => {
    const writes: string[] = []
    const writer = createBufferedWriter({
      writeFn: content => {
        writes.push(content)
      },
      maxBufferSize: 2,
    })

    writer.write('a')
    writer.write('b')
    writer.write('c')
    writer.write('d')
    await waitForImmediate()

    expect(writes).toEqual(['abcd'])
  })

  test('flush drains pending overflow synchronously before the scheduled immediate runs', () => {
    const writes: string[] = []
    const writer = createBufferedWriter({
      writeFn: content => {
        writes.push(content)
      },
      maxBufferSize: 2,
    })

    writer.write('a')
    writer.write('b')
    writer.flush()

    expect(writes).toEqual(['ab'])
  })

  test('dispose flushes remaining buffered content', () => {
    const writes: string[] = []
    const writer = createBufferedWriter({
      writeFn: content => {
        writes.push(content)
      },
    })

    writer.write('tail')
    writer.dispose()

    expect(writes).toEqual(['tail'])
  })
})
