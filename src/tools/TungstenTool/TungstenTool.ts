import { createUnavailableTool } from '../stubTool.js'

export const TUNGSTEN_TOOL_NAME = 'Tungsten'

export const TungstenTool = createUnavailableTool(
  TUNGSTEN_TOOL_NAME,
  'Tungsten is unavailable in this trimmed source tree.',
)

export function clearSessionsWithTungstenUsage(): void {}

export function resetInitializationState(): void {}
