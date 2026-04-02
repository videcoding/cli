import { readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

rmSync(join(root, 'dist'), { recursive: true, force: true })

for (const entry of readdirSync(root, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  if (!entry.name.startsWith('.tmp-')) continue
  rmSync(join(root, entry.name), { recursive: true, force: true })
}

process.stdout.write('Cleaned generated build artifacts.\n')

