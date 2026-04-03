import { describe, expect, test } from 'bun:test'
import { createSignal } from '../../src/utils/signal.ts'

describe('createSignal', () => {
  test('notifies subscribers and supports unsubscribe', () => {
    const signal = createSignal<[number, string]>()
    const calls: Array<[number, string]> = []

    const unsubscribe = signal.subscribe((count, label) => {
      calls.push([count, label])
    })

    signal.emit(1, 'first')
    unsubscribe()
    signal.emit(2, 'second')

    expect(calls).toEqual([[1, 'first']])
  })

  test('clears all listeners', () => {
    const signal = createSignal()
    let count = 0

    signal.subscribe(() => {
      count++
    })
    signal.subscribe(() => {
      count++
    })

    signal.clear()
    signal.emit()

    expect(count).toBe(0)
  })
})
