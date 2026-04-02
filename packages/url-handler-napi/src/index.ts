import { readFileSync } from 'fs'

const sleepBuffer = new Int32Array(new SharedArrayBuffer(4))

function isUrlCandidate(value: string | undefined): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
}

function readUrlFromFallbackFile(path: string | undefined): string | null {
  if (!path) {
    return null
  }
  try {
    const value = readFileSync(path, 'utf8').trim()
    return isUrlCandidate(value) ? value : null
  } catch {
    return null
  }
}

function sleepSync(milliseconds: number): void {
  Atomics.wait(sleepBuffer, 0, 0, milliseconds)
}

function waitForFallbackUrl(timeoutMs: number): string | null {
  const directCandidates = [
    process.env.CLAUDE_CODE_HANDLE_URI,
    process.env.CLAUDE_CODE_URL,
    process.env.LAUNCH_URL,
    ...process.argv,
  ]
  for (const candidate of directCandidates) {
    if (isUrlCandidate(candidate)) {
      return candidate
    }
  }

  const fileCandidates = [
    process.env.CLAUDE_CODE_URL_EVENT_FILE,
    process.env.URL_HANDLER_EVENT_FILE,
  ]

  const deadline = Date.now() + Math.max(0, timeoutMs)
  do {
    for (const candidate of fileCandidates) {
      const url = readUrlFromFallbackFile(candidate)
      if (url) {
        return url
      }
    }
    if (Date.now() >= deadline) {
      break
    }
    sleepSync(50)
  } while (true)

  return null
}

export function waitForUrlEvent(timeoutMs: number): string | null {
  return waitForFallbackUrl(timeoutMs)
}
