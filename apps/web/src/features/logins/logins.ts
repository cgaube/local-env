import { useQuery } from '@tanstack/react-query'
import type {
  LoginRow,
  LoginsResponse,
} from '#services/dashboard/agent-protocol.ts'

// The logins of the sources and their state, which the dashboard agent
// checks on the Mac. Asked when the page opens and on refresh, never on a
// timer: each check is a call to AWS, Vault or Dockhand.
export const useLogins = () =>
  useQuery({
    queryKey: ['logins'],
    queryFn: async () => {
      const response = await fetch('/api/logins')
      if (!response.ok) throw new Error(`/api/logins: ${response.status}`)
      return (await response.json()) as LoginsResponse
    },
    refetchOnWindowFocus: false,
    retry: false,
  })

const STATES: Record<LoginRow['state'], string> = {
  'logged-in': 'Logged in',
  'logged-out': 'Logged out',
  'no-cli': 'CLI missing',
  'not-asked': 'Not asked',
  unknown: 'Unknown',
}

export const stateLabel = (state: LoginRow['state']) => STATES[state]

const KINDS: Record<string, string> = {
  registry: 'Registry',
  aws: 'AWS',
  vault: 'Vault',
}

export const kindLabel = (type: string) => KINDS[type] ?? type

// The account of a login, as people read it: "Registry · ghcr.io". The titles
// of AWS and Vault name their vendor already: "AWS 123456789012 (Dev)".
export const accountLabel = ({
  type,
  title,
}: Pick<LoginRow, 'type' | 'title'>) =>
  type === 'registry' ? `${kindLabel(type)} · ${title}` : title

// "2 logins, 1 needs you"
export const loginsSummary = (logins: LoginRow[]) => {
  const waiting = logins.filter(({ state }) => state !== 'logged-in').length
  const count = `${logins.length} login${logins.length === 1 ? '' : 's'}`
  return waiting === 0
    ? `${count}, all logged in`
    : `${count}, ${waiting} ${waiting === 1 ? 'needs' : 'need'} you`
}
