import { REPL_TOOL_NAME } from './constants.js'
import { createUnavailableTool } from '../stubTool.js'

export const REPLTool = createUnavailableTool(
  REPL_TOOL_NAME,
  'REPL mode is unavailable in this trimmed source tree.',
)
