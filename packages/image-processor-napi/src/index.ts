import { spawnSync } from 'child_process'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { createRequire } from 'module'
import { tmpdir } from 'os'
import { join } from 'path'

const require = createRequire(import.meta.url)

export type ClipboardImageResult = {
  png: Buffer
  originalWidth: number
  originalHeight: number
  width: number
  height: number
}

type ImageProcessor = {
  metadata(): Promise<{ width: number; height: number; format: string }>
  resize(
    width: number,
    height: number,
    options?: { fit?: string; withoutEnlargement?: boolean },
  ): ImageProcessor
  jpeg(quality?: number): ImageProcessor
  png(options?: {
    compressionLevel?: number
    palette?: boolean
    colors?: number
  }): ImageProcessor
  webp(quality?: number): ImageProcessor
  toBuffer(): Promise<Buffer>
}

export type NativeModule = {
  processImage: (input: Buffer) => Promise<ImageProcessor>
  readClipboardImage?: (
    maxWidth: number,
    maxHeight: number,
  ) => ClipboardImageResult | null
  hasClipboardImage?: () => boolean
}

type SharpInstance = {
  metadata(): Promise<{ width?: number; height?: number; format?: string }>
  resize(
    width: number,
    height: number,
    options?: { fit?: string; withoutEnlargement?: boolean },
  ): SharpInstance
  jpeg(options?: { quality?: number }): SharpInstance
  png(options?: {
    compressionLevel?: number
    palette?: boolean
    colors?: number
  }): SharpInstance
  webp(options?: { quality?: number }): SharpInstance
  toBuffer(): Promise<Buffer>
}

type SharpFactory = (input: Buffer) => SharpInstance
type MaybeDefault<T> = T | { default: T }

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
])

let cachedSharpFactory: SharpFactory | null = null

function getSharpFactory(): SharpFactory {
  if (cachedSharpFactory) {
    return cachedSharpFactory
  }
  const imported = require('sharp') as MaybeDefault<SharpFactory>
  cachedSharpFactory =
    typeof imported === 'function' ? imported : imported.default
  return cachedSharpFactory
}

function createSharpProcessor(input: Buffer): ImageProcessor {
  const sharpFactory = getSharpFactory()
  let pipeline = sharpFactory(input)

  const processor: ImageProcessor = {
    async metadata() {
      const metadata = await pipeline.metadata()
      return {
        width: metadata.width ?? 0,
        height: metadata.height ?? 0,
        format: metadata.format ?? 'unknown',
      }
    },
    resize(width, height, options) {
      pipeline = pipeline.resize(width, height, options)
      return processor
    },
    jpeg(quality) {
      pipeline = pipeline.jpeg(
        quality === undefined ? undefined : { quality },
      )
      return processor
    },
    png(options) {
      pipeline = pipeline.png(options)
      return processor
    },
    webp(quality) {
      pipeline = pipeline.webp(
        quality === undefined ? undefined : { quality },
      )
      return processor
    },
    toBuffer() {
      return pipeline.toBuffer()
    },
  }

  return processor
}

function createFallbackModule(): NativeModule {
  return {
    async processImage(input: Buffer) {
      return createSharpProcessor(input)
    },
    hasClipboardImage: process.platform === 'darwin' ? hasClipboardImage : undefined,
    readClipboardImage:
      process.platform === 'darwin' ? readClipboardImage : undefined,
  }
}

// Raw binding accessor. Callers that need optional exports (e.g. clipboard
// functions) reach through this; keeping the wrappers on the caller side lets
// feature() tree-shake the property access strings out of external builds.
export function getNativeModule(): NativeModule | null {
  return createFallbackModule()
}

function escapeAppleScriptString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

function readPngDimensions(
  buffer: Buffer,
): { width: number; height: number } | null {
  if (buffer.length < 24) {
    return null
  }
  if (!buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return null
  }
  if (buffer.toString('ascii', 12, 16) !== 'IHDR') {
    return null
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  }
}

function writeClipboardPng(targetPath: string): Buffer | null {
  const escaped = escapeAppleScriptString(targetPath)
  const result = spawnSync(
    '/usr/bin/osascript',
    [
      '-e',
      'set png_data to (the clipboard as «class PNGf»)',
      '-e',
      `set fp to open for access POSIX file "${escaped}" with write permission`,
      '-e',
      'write png_data to fp',
      '-e',
      'close access fp',
    ],
    { stdio: 'pipe' },
  )

  if (result.status !== 0) {
    return null
  }

  try {
    return readFileSync(targetPath)
  } catch {
    return null
  }
}

function resizePngSync(
  inputPath: string,
  outputPath: string,
  width: number,
  height: number,
): Buffer | null {
  const result = spawnSync(
    '/usr/bin/sips',
    [
      '-s',
      'format',
      'png',
      '-z',
      String(height),
      String(width),
      inputPath,
      '--out',
      outputPath,
    ],
    { stdio: 'pipe' },
  )

  if (result.status !== 0) {
    return null
  }

  try {
    return readFileSync(outputPath)
  } catch {
    return null
  }
}

function hasClipboardImage(): boolean {
  const result = spawnSync(
    '/usr/bin/osascript',
    ['-e', 'the clipboard as «class PNGf»'],
    { stdio: 'pipe' },
  )
  return result.status === 0
}

function readClipboardImage(
  maxWidth: number,
  maxHeight: number,
): ClipboardImageResult | null {
  const tempDir = mkdtempSync(join(tmpdir(), 'claude-image-processor-'))
  const clipboardPath = join(tempDir, 'clipboard.png')
  const resizedPath = join(tempDir, 'clipboard-resized.png')

  try {
    const buffer = writeClipboardPng(clipboardPath)
    if (!buffer) {
      return null
    }

    const original = readPngDimensions(buffer)
    if (!original) {
      return null
    }

    let png = buffer
    let width = original.width
    let height = original.height

    const safeMaxWidth = Math.max(1, Math.floor(maxWidth))
    const safeMaxHeight = Math.max(1, Math.floor(maxHeight))
    const scale = Math.min(
      1,
      safeMaxWidth / Math.max(width, 1),
      safeMaxHeight / Math.max(height, 1),
    )

    if (scale < 1) {
      const targetWidth = Math.max(1, Math.round(width * scale))
      const targetHeight = Math.max(1, Math.round(height * scale))
      const resized = resizePngSync(
        clipboardPath,
        resizedPath,
        targetWidth,
        targetHeight,
      )
      if (resized) {
        const resizedDimensions = readPngDimensions(resized)
        if (resizedDimensions) {
          png = resized
          width = resizedDimensions.width
          height = resizedDimensions.height
        }
      }
    }

    return {
      png,
      originalWidth: original.width,
      originalHeight: original.height,
      width,
      height,
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

interface SharpInstancePublic {
  metadata(): Promise<{ width: number; height: number; format: string }>
  resize(
    width: number,
    height: number,
    options?: { fit?: string; withoutEnlargement?: boolean },
  ): SharpInstancePublic
  jpeg(options?: { quality?: number }): SharpInstancePublic
  png(options?: {
    compressionLevel?: number
    palette?: boolean
    colors?: number
  }): SharpInstancePublic
  webp(options?: { quality?: number }): SharpInstancePublic
  toBuffer(): Promise<Buffer>
}

// Factory function that matches sharp's API
export function sharp(input: Buffer): SharpInstancePublic {
  let processorPromise: Promise<ImageProcessor> | null = null

  // Create a chain of operations
  const operations: Array<(proc: ImageProcessor) => void> = []

  // Track how many operations have been applied to avoid re-applying
  let appliedOperationsCount = 0

  // Get or create the processor (without applying operations)
  async function ensureProcessor(): Promise<ImageProcessor> {
    if (!processorPromise) {
      processorPromise = (async () => {
        const mod = getNativeModule()
        if (!mod) {
          throw new Error('Native image processor module not available')
        }
        return mod.processImage(input)
      })()
    }
    return processorPromise
  }

  // Apply any pending operations to the processor
  function applyPendingOperations(proc: ImageProcessor): void {
    for (let i = appliedOperationsCount; i < operations.length; i++) {
      const op = operations[i]
      if (op) {
        op(proc)
      }
    }
    appliedOperationsCount = operations.length
  }

  const instance: SharpInstancePublic = {
    async metadata() {
      const proc = await ensureProcessor()
      return proc.metadata()
    },

    resize(
      width: number,
      height: number,
      options?: { fit?: string; withoutEnlargement?: boolean },
    ) {
      operations.push(proc => {
        proc.resize(width, height, options)
      })
      return instance
    },

    jpeg(options?: { quality?: number }) {
      operations.push(proc => {
        proc.jpeg(options?.quality)
      })
      return instance
    },

    png(options?: {
      compressionLevel?: number
      palette?: boolean
      colors?: number
    }) {
      operations.push(proc => {
        proc.png(options)
      })
      return instance
    },

    webp(options?: { quality?: number }) {
      operations.push(proc => {
        proc.webp(options?.quality)
      })
      return instance
    },

    async toBuffer() {
      const proc = await ensureProcessor()
      applyPendingOperations(proc)
      return proc.toBuffer()
    },
  }

  return instance
}

export default sharp
