import { z } from 'zod/v4'
import { buildTool } from '../Tool.js'

const inputSchema = z.object({}).passthrough()
const outputSchema = z.object({
  ok: z.literal(true),
  unavailable: z.string(),
})

export function createUnavailableTool(name: string, unavailable: string) {
  return buildTool({
    name,
    maxResultSizeChars: 8_192,
    async description() {
      return unavailable
    },
    async prompt() {
      return unavailable
    },
    get inputSchema() {
      return inputSchema
    },
    get outputSchema() {
      return outputSchema
    },
    isEnabled() {
      return false
    },
    isConcurrencySafe() {
      return true
    },
    isReadOnly() {
      return true
    },
    async call() {
      return {
        data: {
          ok: true as const,
          unavailable,
        },
      }
    },
  })
}
