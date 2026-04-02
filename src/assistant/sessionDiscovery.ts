import { fetchCodeSessionsFromSessionsAPI } from '../utils/teleport/api.js'
import { formatRelativeTime } from '../utils/format.js'

export type AssistantSession = {
  id: string
  label: string
  title: string
  updatedAt: string
}

export async function discoverAssistantSessions(): Promise<AssistantSession[]> {
  const sessions = await fetchCodeSessionsFromSessionsAPI()
  return sessions
    .filter(session => session.status !== 'archived')
    .sort(
      (left, right) =>
        new Date(right.updated_at).getTime() -
        new Date(left.updated_at).getTime(),
    )
    .map(session => ({
      id: session.id,
      title: session.title,
      updatedAt: session.updated_at,
      label: `${formatRelativeTime(new Date(session.updated_at))}  ${session.title}`,
    }))
}
