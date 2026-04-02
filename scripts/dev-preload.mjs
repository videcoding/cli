import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

const feedbackChannel =
  process.env.CLAUDE_CODE_FEEDBACK_CHANNEL ||
  pkg.bugs?.url ||
  'https://github.com/anthropics/claude-code/issues'

const packageUrl =
  process.env.CLAUDE_CODE_PACKAGE_URL ||
  pkg.name ||
  '@videcoding/cli'

if (!process.env.USER_TYPE) {
  process.env.USER_TYPE = 'external'
}

globalThis.MACRO = Object.freeze({
  ISSUES_EXPLAINER:
    process.env.CLAUDE_CODE_ISSUES_EXPLAINER ||
    `report the issue at ${feedbackChannel}`,
  PACKAGE_URL: packageUrl,
  README_URL:
    process.env.CLAUDE_CODE_README_URL ||
    'https://code.claude.com/docs/en/overview',
  VERSION: pkg.version || '0.0.0',
  FEEDBACK_CHANNEL: feedbackChannel,
  BUILD_TIME: process.env.CLAUDE_CODE_BUILD_TIME || new Date().toISOString(),
  NATIVE_PACKAGE_URL:
    process.env.CLAUDE_CODE_NATIVE_PACKAGE_URL || packageUrl,
  VERSION_CHANGELOG: process.env.CLAUDE_CODE_VERSION_CHANGELOG || '',
})
