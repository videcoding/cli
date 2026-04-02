import { VERIFY_PLAN_EXECUTION_TOOL_NAME } from './constants.js'
import { createUnavailableTool } from '../stubTool.js'

export const VerifyPlanExecutionTool = createUnavailableTool(
  VERIFY_PLAN_EXECUTION_TOOL_NAME,
  'Plan verification is unavailable in this trimmed source tree.',
)
