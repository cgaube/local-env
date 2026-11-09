import { S_WARN } from '@clack/prompts'
import { execa } from 'execa'
import { styleText } from 'node:util'
import { hasCommand } from '#cli/utils/brew.js'
import { canAsk } from '#cli/utils/prompt.js'
import type {
  DeclaredLogin,
  LoginStatus,
  SessionLoginType,
} from '#cli/logins/types.js'

// Runs what a session login type describes: its status, its login and its
// logout, with the vendor's CLI. Each call gets the login's environment.

// Not from the dashboard: its terminal is the agent's pty, and a login
// opens a browser or asks for a password, which belongs in your own
// terminal (the agent sets LOCAL_ENV_FROM_DASHBOARD)
export const canLogIn = () =>
  canAsk() && process.env.LOCAL_ENV_FROM_DASHBOARD !== '1'

const lastLine = (text: string) =>
  text.trim().split('\n').filter(Boolean).at(-1) ?? ''

export const sessionStatus = async <Config>(
  type: SessionLoginType<Config>,
  login: DeclaredLogin<Config>,
): Promise<LoginStatus> => {
  if (!(await hasCommand(type.cli.binary))) return { state: 'no-cli' }
  const [command, ...args] = type.statusCommand(login)
  const result = await execa(command!, args, {
    env: type.env(login),
    reject: false,
    stdin: 'ignore',
    timeout: 30_000,
  })
  return result.exitCode === 0
    ? { state: 'logged-in', detail: type.describeSession(result.stdout) }
    : { state: 'logged-out', detail: lastLine(String(result.stderr)) }
}

// The vendor's CLI talks to the user: the browser, an MFA code or a
// password goes between them, never through local-env
const runWithTerminal = async (
  command: string[],
  env: Record<string, string>,
) => {
  const [binary, ...args] = command
  const { exitCode } = await execa(binary!, args, {
    env,
    stdio: 'inherit',
    reject: false,
  })
  return exitCode === 0
}

// True once the CLI logged in. Throws when local-env cannot log in to it.
export const logInToSession = async <Config>(
  type: SessionLoginType<Config>,
  login: DeclaredLogin<Config>,
) => {
  const command = type.loginCommand(login)
  if (!command) {
    const help = type.help(login.config)
    throw new Error(
      `local-env cannot log in to ${type.title(login.config)} for you: it is your own profile.${help ? ` ${help}` : ''}`,
    )
  }
  return runWithTerminal(command, type.env(login))
}

export const logOutOfSession = async <Config>(
  type: SessionLoginType<Config>,
  login: DeclaredLogin<Config>,
) => {
  const command = type.logoutCommand(login)
  if (!command) return false
  return runWithTerminal(command, type.env(login))
}

export const loginCommandFor = (source: string, name: string) =>
  `local-env sources login ${source} --login ${name}`

// One line for a session login of a source, as for a registry login: its
// name, the account, the state and what to do
export const sessionLoginLine = <Config>(
  type: SessionLoginType<Config>,
  login: DeclaredLogin<Config>,
  status: LoginStatus,
) => {
  const what = `${login.name}  ${styleText('dim', type.title(login.config))}`
  if (status.state === 'logged-in') {
    return `${styleText('green', '✔')} ${what}  logged in ${status.detail.replace(/^logged in ?/, '')}`.trimEnd()
  }
  const warn = styleText('yellow', S_WARN)
  if (status.state === 'no-cli') {
    return `${warn} ${what}  needs the ${type.cli.binary} CLI: ${styleText('dim', `brew install ${type.cli.formula}`)}`
  }
  return `${warn} ${what}  logged out: ${styleText('dim', loginCommandFor(login.source, login.name))}`
}
