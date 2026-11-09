import type {
  LoginRow,
  LoginsReport,
} from '#services/dashboard/agent-protocol.js'
import { listAccounts } from '#cli/logins/declared.js'
import { SESSION_TYPES } from '#cli/logins/index.js'
import {
  findLogin,
  getRegistries,
  isIgnored,
  registryLogin,
} from '#cli/logins/registry.js'
import { loginCommandFor, sessionStatus } from '#cli/logins/session.js'

// Every login of the sources and its state, for the dashboard (the agent's
// GET /logins). Each account once; the sessions are checked in parallel.

const asWhom = (detail: string) => detail.replace(/^logged in ?/, '') || null

const registryRows = async (): Promise<LoginRow[]> => {
  const accounts = listAccounts(registryLogin)
  if (accounts.length === 0) return []
  const registries = await getRegistries().catch(() => undefined)
  return accounts.map(({ login, sources }) => {
    const base = {
      type: registryLogin.type,
      name: login.name,
      title: registryLogin.title(login.config),
      sources,
      help: null,
    }
    const command = loginCommandFor(login.source, login.name)
    if (!registries) {
      return {
        ...base,
        state: 'unknown' as const,
        detail: "can't reach Dockhand",
        command: null,
      }
    }
    const saved = findLogin(registries, login.config.host)
    if (saved) {
      return {
        ...base,
        state: 'logged-in' as const,
        detail: saved.username ? `as ${saved.username}` : null,
        command: null,
      }
    }
    return {
      ...base,
      state: isIgnored(login.config.host)
        ? ('not-asked' as const)
        : ('logged-out' as const),
      detail: null,
      command,
    }
  })
}

const sessionRows = () =>
  Promise.all(
    SESSION_TYPES.flatMap((type) =>
      listAccounts(type).map(async ({ login, sources }): Promise<LoginRow> => {
        const status = await sessionStatus(type, login)
        const help = type.help(login.config) ?? null
        const base = {
          type: type.type,
          name: login.name,
          title: type.title(login.config),
          sources,
          help,
        }
        if (status.state === 'logged-in') {
          return {
            ...base,
            state: 'logged-in',
            detail: asWhom(status.detail),
            command: null,
          }
        }
        if (status.state === 'no-cli') {
          return {
            ...base,
            state: 'no-cli',
            detail: `the ${type.cli.binary} CLI is not installed`,
            command: `brew install ${type.cli.formula}`,
          }
        }
        return {
          ...base,
          state: 'logged-out',
          detail: status.detail || null,
          command: loginCommandFor(login.source, login.name),
        }
      }),
    ),
  )

export const buildLoginsReport = async (): Promise<LoginsReport> => {
  const [registries, sessions] = await Promise.all([
    registryRows(),
    sessionRows(),
  ])
  return { logins: [...registries, ...sessions] }
}
