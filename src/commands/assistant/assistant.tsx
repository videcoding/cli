import React, { useState } from 'react'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { getCwd } from '../../utils/cwd.js'
import { Box, Text } from '../../ink.js'
import { Dialog } from '../../components/design-system/Dialog.js'
import { Select } from '../../components/CustomSelect/index.js'
import { Spinner } from '../../components/Spinner.js'

const DAEMON_FILE = 'daemon.json'
const LOCAL_SETTINGS_REL = join('.claude', 'settings.local.json')
const SCHEDULED_TASKS_REL = join('.claude', 'scheduled_tasks.json')

export async function computeDefaultInstallDir(): Promise<string> {
  return join(getCwd(), '.claude', 'assistant')
}

async function ensureJsonFile(
  path: string,
  nextValue: Record<string, unknown> | unknown[],
): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(`${path}`, `${JSON.stringify(nextValue, null, 2)}\n`, 'utf8')
}

async function mergeLocalSettings(rootDir: string): Promise<void> {
  const filePath = join(rootDir, LOCAL_SETTINGS_REL)
  let current: Record<string, unknown> = {}
  try {
    const raw = await readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      current = parsed as Record<string, unknown>
    }
  } catch {
    // Fresh install path.
  }

  await ensureJsonFile(filePath, {
    ...current,
    defaultView: 'chat',
  })
}

async function installAssistant(defaultDir: string): Promise<string> {
  await mkdir(defaultDir, { recursive: true })

  await ensureJsonFile(join(defaultDir, DAEMON_FILE), {
    version: 1,
    mode: 'assistant',
    installDir: defaultDir,
    createdAt: new Date().toISOString(),
  })
  await ensureJsonFile(join(getCwd(), SCHEDULED_TASKS_REL), [])
  await mergeLocalSettings(getCwd())
  return defaultDir
}

type Props = {
  defaultDir: string
  onInstalled: (dir: string) => void
  onCancel: () => void
  onError: (message: string) => void
}

export function NewInstallWizard({
  defaultDir,
  onInstalled,
  onCancel,
  onError,
}: Props): React.ReactNode {
  const [installing, setInstalling] = useState(false)

  return (
    <Dialog title="Install Assistant" onCancel={onCancel} color="background">
      <Text dimColor>
        No assistant sessions were found. Install the local assistant worker
        scaffold into:
      </Text>
      <Text bold>{defaultDir}</Text>

      {installing ? (
        <Box flexDirection="row">
          <Spinner />
          <Text> Preparing assistant files…</Text>
        </Box>
      ) : (
        <Select
          options={[
            { label: 'Install here', value: 'install' },
            { label: 'Cancel', value: 'cancel' },
          ]}
          onChange={value => {
            if (value === 'cancel') {
              onCancel()
              return
            }

            setInstalling(true)
            void installAssistant(defaultDir)
              .then(installedDir => {
                onInstalled(installedDir)
              })
              .catch(error => {
                onError(
                  error instanceof Error ? error.message : String(error),
                )
              })
              .finally(() => {
                setInstalling(false)
              })
          }}
        />
      )}
    </Dialog>
  )
}
