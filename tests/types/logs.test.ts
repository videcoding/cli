import { describe, expect, test } from 'bun:test'
import { sortLogs } from '../../src/types/logs.ts'

describe('sortLogs', () => {
  test('sorts by modified date first and uses created date as a tie-breaker', () => {
    const logs = [
      {
        modified: new Date('2024-01-01T00:00:00.000Z'),
        created: new Date('2024-01-01T00:00:00.000Z'),
        value: 0,
      },
      {
        modified: new Date('2024-01-03T00:00:00.000Z'),
        created: new Date('2024-01-01T00:00:00.000Z'),
        value: 1,
      },
      {
        modified: new Date('2024-01-03T00:00:00.000Z'),
        created: new Date('2024-01-02T00:00:00.000Z'),
        value: 2,
      },
    ] as never

    const sorted = sortLogs(logs)

    expect(sorted.map(log => log.value)).toEqual([2, 1, 0])
  })
})
