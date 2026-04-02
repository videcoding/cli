// Pure-JS audio capture module. Replaces the pre-compiled NAPI binary with
// subprocess backends: SoX (rec/play) as primary, ALSA (arecord/aplay) as
// Linux fallback. The public API is identical to the former NAPI wrapper so
// callers (voice.ts) require no changes.

import { type ChildProcess, spawn, spawnSync } from 'child_process'

const SAMPLE_RATE = 16000
const CHANNELS = 1
// SoX silence-detection parameters — mirror the cpal native module's
// auto-stop-on-silence behaviour.
const SILENCE_DURATION_SECS = '2.0'
const SILENCE_THRESHOLD = '3%'

// ─── State ─────────────────────────────────────────────────────────────────

let isRecording = false
let recordProcess: ChildProcess | null = null
// Track explicit stops per child so a late close event from the previous
// recorder cannot suppress or spuriously trigger callbacks for the next one.
const explicitlyStoppedRecorders = new WeakSet<ChildProcess>()

let isPlaying = false
let playProcess: ChildProcess | null = null

// ─── Helpers ───────────────────────────────────────────────────────────────

function hasCommand(cmd: string): boolean {
  const result = spawnSync(cmd, ['--version'], { stdio: 'ignore', timeout: 3000 })
  return result.error === undefined
}

// Prefer SoX because it supports built-in silence detection. Fall back to
// arecord on Linux when SoX is absent.
function recordingBackend(): 'sox' | 'arecord' | null {
  if (hasCommand('rec')) return 'sox'
  if (process.platform === 'linux' && hasCommand('arecord')) return 'arecord'
  return null
}

// Prefer SoX play; fall back to aplay on Linux.
function playbackBackend(): 'sox' | 'aplay' | null {
  if (hasCommand('play')) return 'sox'
  if (process.platform === 'linux' && hasCommand('aplay')) return 'aplay'
  return null
}

// ─── Public API ────────────────────────────────────────────────────────────

export function isNativeAudioAvailable(): boolean {
  const platform = process.platform
  if (platform !== 'darwin' && platform !== 'linux' && platform !== 'win32') {
    return false
  }
  return recordingBackend() !== null
}

export function startNativeRecording(
  onData: (data: Buffer) => void,
  onEnd: () => void,
): boolean {
  if (isRecording) return false

  const backend = recordingBackend()
  if (!backend) return false

  let child: ChildProcess

  if (backend === 'arecord') {
    // arecord has no built-in silence detection; the caller is responsible
    // for stopping via stopNativeRecording() (push-to-talk usage).
    child = spawn(
      'arecord',
      [
        '-f', 'S16_LE', // signed 16-bit little-endian
        '-r', String(SAMPLE_RATE),
        '-c', String(CHANNELS),
        '-t', 'raw', // raw PCM, no WAV header
        '-q', // suppress progress output
        '-', // write to stdout
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    )
  } else {
    // SoX with silence detection: process exits naturally after
    // SILENCE_DURATION_SECS of silence, triggering onEnd automatically.
    // --buffer 1024 forces small flushes so onData fires promptly.
    child = spawn(
      'rec',
      [
        '-q',
        '--buffer', '1024',
        '-t', 'raw',
        '-r', String(SAMPLE_RATE),
        '-e', 'signed',
        '-b', '16',
        '-c', String(CHANNELS),
        '-',
        'silence', '1', '0.1', SILENCE_THRESHOLD,
        '1', SILENCE_DURATION_SECS, SILENCE_THRESHOLD,
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    )
  }

  recordProcess = child
  isRecording = true

  child.stdout?.on('data', (chunk: Buffer) => {
    onData(chunk)
  })

  const handleClose = () => {
    if (recordProcess === child) {
      recordProcess = null
      isRecording = false
    }
    const wasStoppedExplicitly = explicitlyStoppedRecorders.has(child)
    explicitlyStoppedRecorders.delete(child)
    // Only fire onEnd for natural termination (silence detection).
    // Explicit stopNativeRecording() calls suppress it, matching cpal behaviour.
    if (!wasStoppedExplicitly) {
      onEnd()
    }
  }

  child.on('close', handleClose)
  child.on('error', handleClose)

  return true
}

export function stopNativeRecording(): void {
  if (recordProcess) {
    explicitlyStoppedRecorders.add(recordProcess)
    recordProcess.kill('SIGTERM')
    recordProcess = null
  }
  isRecording = false
}

export function isNativeRecordingActive(): boolean {
  return isRecording
}

export function startNativePlayback(sampleRate: number, channels: number): boolean {
  if (isPlaying) stopNativePlayback()

  const backend = playbackBackend()
  if (!backend) return false

  let child: ChildProcess

  if (backend === 'aplay') {
    child = spawn(
      'aplay',
      [
        '-f', 'S16_LE',
        '-r', String(sampleRate),
        '-c', String(channels),
        '-t', 'raw',
        '-q',
        '-',
      ],
      { stdio: ['pipe', 'ignore', 'ignore'] },
    )
  } else {
    child = spawn(
      'play',
      [
        '-q',
        '-t', 'raw',
        '-r', String(sampleRate),
        '-e', 'signed',
        '-b', '16',
        '-c', String(channels),
        '-',
      ],
      { stdio: ['pipe', 'ignore', 'ignore'] },
    )
  }

  playProcess = child
  isPlaying = true

  const handleClose = () => {
    if (playProcess === child) {
      playProcess = null
      isPlaying = false
    }
  }

  child.on('close', handleClose)
  child.on('error', handleClose)

  return true
}

export function writeNativePlaybackData(data: Buffer): void {
  playProcess?.stdin?.write(data)
}

export function stopNativePlayback(): void {
  if (playProcess) {
    playProcess.stdin?.end()
    playProcess.kill('SIGTERM')
    playProcess = null
  }
  isPlaying = false
}

export function isNativePlaying(): boolean {
  return isPlaying
}

// Returns the microphone authorization status.
// macOS: 0 (notDetermined) — TCC cannot be queried from pure JS; the system
//        permission prompt appears on the first recording attempt.
// Linux: 3 (authorized) — no system-level microphone permission API.
// Windows: 3 (authorized) — registry check requires Win32 API; assume OK.
// Other/unavailable: 0 (notDetermined).
export function microphoneAuthorizationStatus(): number {
  const platform = process.platform
  if (platform === 'linux' || platform === 'win32') return 3
  return 0 // darwin or unknown — cannot check without native code
}
