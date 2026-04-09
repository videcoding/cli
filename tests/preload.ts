import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

process.env.NODE_ENV = 'test'
process.env.USER_TYPE ??= 'external'

const macroTarget = globalThis as typeof globalThis & {
  MACRO?: Readonly<Record<string, string>>
}

macroTarget.MACRO = Object.freeze({
  ISSUES_EXPLAINER:
    process.env.CLAUDE_CODE_ISSUES_EXPLAINER ||
    `report the issue at ${pkg.bugs?.url || 'https://github.com/videcoding/cli/issues'}`,
  PACKAGE_URL:
    process.env.CLAUDE_CODE_PACKAGE_URL ||
    pkg.homepage ||
    'https://github.com/videcoding/cli',
  README_URL:
    process.env.CLAUDE_CODE_README_URL ||
    'https://code.claude.com/docs/en/overview',
  VERSION: pkg.version || '0.0.0',
  FEEDBACK_CHANNEL:
    process.env.CLAUDE_CODE_FEEDBACK_CHANNEL ||
    pkg.bugs?.url ||
    'https://github.com/videcoding/cli/issues',
  BUILD_TIME: process.env.CLAUDE_CODE_BUILD_TIME || '1970-01-01T00:00:00.000Z',
  NATIVE_PACKAGE_URL:
    process.env.CLAUDE_CODE_NATIVE_PACKAGE_URL ||
    process.env.CLAUDE_CODE_PACKAGE_URL ||
    pkg.homepage ||
    'https://github.com/videcoding/cli',
  VERSION_CHANGELOG: process.env.CLAUDE_CODE_VERSION_CHANGELOG || '',
})
