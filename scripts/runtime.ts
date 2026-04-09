import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface PackageJson {
  version?: string
  homepage?: string
  bugs?: {
    url?: string
  }
}

export interface MacroValues {
  ISSUES_EXPLAINER: string
  PACKAGE_URL: string
  README_URL: string
  VERSION: string
  FEEDBACK_CHANNEL: string
  BUILD_TIME: string
  NATIVE_PACKAGE_URL: string
  VERSION_CHANGELOG: string
}

export const root = process.cwd()
export const distDir = join(root, 'dist')
export const sourceOutDir = join(distDir, 'src-build')
export const sourceEntrypoint = 'src/entrypoints/cli.tsx'
export const sourceBundle = join(sourceOutDir, 'cli.js')
export const sourceBuildLog = join(distDir, 'source-build.log')
export const binaryOut = join(distDir, 'claude')
export const enabledFeatures: string[] = ['BUDDY']

export function getPackageJson(): PackageJson {
  return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as PackageJson
}

export function getMacroValues(pkg: PackageJson): MacroValues {
  const feedbackChannel =
    process.env.CLAUDE_CODE_FEEDBACK_CHANNEL ||
    pkg.bugs?.url ||
    'https://github.com/videcoding/cli/issues'
  const packageUrl =
    process.env.CLAUDE_CODE_PACKAGE_URL ||
    pkg.homepage ||
    'https://github.com/videcoding/cli'

  return {
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
  }
}

export function getMacroBanner(macroValues: MacroValues): string {
  return `const MACRO = Object.freeze(${JSON.stringify(macroValues)});\n`
}

export function getSourceBuildOptions(): {
  pkg: PackageJson
  buildOptions: Parameters<typeof Bun.build>[0]
} {
  const pkg = getPackageJson()

  return {
    pkg,
    buildOptions: {
      entrypoints: [sourceEntrypoint],
      outdir: sourceOutDir,
      target: 'node',
      format: 'esm',
      banner: getMacroBanner(getMacroValues(pkg)),
      define: {
        'process.env.USER_TYPE': JSON.stringify('external'),
      },
      features: enabledFeatures,
    },
  }
}
