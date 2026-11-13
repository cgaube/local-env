import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import { logger } from '#cli/utils/logger.js'
import {
  type IniSection,
  readIniSection,
  removeIniSections,
  writeIniSections,
} from '#cli/logins/ini.js'
import { ecrRegion } from '#cli/logins/registry.js'
import { readAwsSections, writeAwsSections } from '#cli/logins/state.js'
import {
  type DeclaredLogin,
  isRecord,
  optionalText,
  requiredText,
  type SessionLoginType,
} from '#cli/logins/types.js'

// An AWS account, for AWS Secrets Manager (or any AWS CLI call) in roles:
//   acme-dev:
//     type: aws
//     region: eu-west-1
//     sso: { startUrl, region, accountId, roleName }
//     help: Request the dev account in #platform
// With `sso`, local-env writes the profile local-env-<source>-<login> in
// ~/.aws/config, and an sso-session for each start URL: one browser login
// covers every account of an Identity Center. Without it, `profile` names
// one the user set up (credential_process, aws-vault…).

export type AwsSso = {
  startUrl: string
  region: string
  accountId: string
  roleName: string
}

export type AwsConfig = {
  region?: string
  // The user's own profile, without sso
  profile?: string
  sso?: AwsSso
  help?: string
}

export const awsConfigFile = () =>
  process.env.AWS_CONFIG_FILE ?? join(homedir(), '.aws', 'config')

// The profile a role's tasks use
export const awsProfile = ({
  source,
  name,
  config,
}: DeclaredLogin<AwsConfig>) => config.profile ?? `local-env-${source}-${name}`

// One for each Identity Center: its profiles share the SSO token
export const ssoSessionName = ({ startUrl, region }: AwsSso) =>
  `local-env-${createHash('sha256')
    .update(`${startUrl}\n${region}`)
    .digest('hex')
    .slice(0, 8)}`

const parseSso = (value: unknown): AwsSso | undefined => {
  if (value === undefined || value === null) return undefined
  if (!isRecord(value)) throw new Error('sso must be a mapping')
  const field = (name: string) => {
    try {
      return requiredText(value, name)
    } catch (error) {
      throw new Error(
        `sso.${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  // YAML reads an account id without quotes as a number
  const accountId =
    typeof value.accountId === 'number'
      ? String(value.accountId)
      : field('accountId')
  if (!/^\d{12}$/.test(accountId)) {
    throw new Error('sso.accountId must be the 12 digits of the account')
  }
  return {
    startUrl: field('startUrl'),
    region: field('region'),
    accountId,
    roleName: field('roleName'),
  }
}

// The sections of ~/.aws/config of a login with sso
const sectionsOf = (login: DeclaredLogin<AwsConfig>): IniSection[] => {
  const { sso, region } = login.config
  if (!sso) return []
  const session = ssoSessionName(sso)
  return [
    {
      header: `sso-session ${session}`,
      values: {
        sso_start_url: sso.startUrl,
        sso_region: sso.region,
        sso_registration_scopes: 'sso:account:access',
      },
    },
    {
      header: `profile ${awsProfile(login)}`,
      values: {
        sso_session: session,
        sso_account_id: sso.accountId,
        sso_role_name: sso.roleName,
        region: region ?? sso.region,
      },
    },
  ]
}

const readConfigFile = () =>
  existsSync(awsConfigFile()) ? readFileSync(awsConfigFile(), 'utf8') : ''

const writeConfigFile = (content: string) => {
  mkdirSync(dirname(awsConfigFile()), { recursive: true })
  writeFileSync(awsConfigFile(), content)
}

// Writes the sections of the login, but never one the user wrote: a section
// of that header that local-env did not write stays, with a warning
export const configureAws = (login: DeclaredLogin<AwsConfig>) => {
  const sections = sectionsOf(login)
  if (sections.length === 0) return
  const ours = new Set(readAwsSections())
  const content = readConfigFile()
  const writable = sections.filter(({ header, values }) => {
    const existing = readIniSection(content, header)
    if (!existing || ours.has(header)) return true
    const same = Object.entries(values).every(
      ([key, value]) => existing[key] === value,
    )
    if (!same) {
      logger.warn(
        `${awsConfigFile().replace(homedir(), '~')} has its own [${header}]: local-env leaves it as it is.`,
      )
    }
    return false
  })
  if (writable.length === 0) return
  const next = writeIniSections(content, writable)
  if (next !== content) writeConfigFile(next)
  writeAwsSections([...ours, ...writable.map(({ header }) => header)])
}

// The user's own profile is an AWS SSO profile: `aws sso login` logs in to
// it. Not a profile that runs a program (Granted's credential_process,
// aws-vault): only the program knows how to log in.
export const isSsoProfile = (profile: string) => {
  const header = profile === 'default' ? 'default' : `profile ${profile}`
  const values = readIniSection(readConfigFile(), header)
  return Boolean(values && (values.sso_session || values.sso_start_url))
}

// Removes the sections local-env wrote that none of these logins needs
// (the logins of every source)
export const pruneAwsConfig = (logins: DeclaredLogin<AwsConfig>[]) => {
  const ours = readAwsSections()
  if (ours.length === 0) return
  const needed = new Set(
    logins.flatMap((login) => sectionsOf(login).map(({ header }) => header)),
  )
  const unused = ours.filter((header) => !needed.has(header))
  if (unused.length === 0) return
  const content = readConfigFile()
  const next = removeIniSections(content, unused)
  if (next !== content) writeConfigFile(next)
  writeAwsSections(ours.filter((header) => needed.has(header)))
}

export const awsLogin: SessionLoginType<AwsConfig> = {
  type: 'aws',
  parse: (entry) => {
    const sso = parseSso(entry.sso)
    const profile = optionalText(entry, 'profile')
    if (sso && profile) {
      throw new Error(
        'profile is for a profile of your own, without sso: give one of them',
      )
    }
    if (!sso && !profile) throw new Error('sso or profile is required')
    return {
      sso,
      profile,
      region: optionalText(entry, 'region'),
      help: optionalText(entry, 'help'),
    }
  },
  // Its profile is named after its source and its name
  identity: (_config, { source, name }) => `${source}/${name}`,
  title: ({ sso, profile }) =>
    sso ? `AWS ${sso.accountId} (${sso.roleName})` : `AWS profile ${profile}`,
  cli: { binary: 'aws', formula: 'awscli' },
  env: (login) => ({
    AWS_PROFILE: awsProfile(login),
    ...(login.config.region || login.config.sso
      ? { AWS_REGION: login.config.region ?? login.config.sso!.region }
      : {}),
  }),
  configure: configureAws,
  statusCommand: (login) => [
    'aws',
    'sts',
    'get-caller-identity',
    '--profile',
    awsProfile(login),
    '--output',
    'json',
  ],
  describeSession: (stdout) => {
    try {
      const { Arn } = JSON.parse(stdout) as { Arn?: string }
      return Arn ? `as ${Arn}` : 'logged in'
    } catch {
      return 'logged in'
    }
  },
  loginHint: () => 'the AWS CLI opens your browser to log in',
  // With sso, or the user's own AWS SSO profile. Logging out stays for sso
  // only: the user's profile can share its session with their other tools.
  loginCommand: (login) =>
    login.config.sso ||
    (login.config.profile && isSsoProfile(login.config.profile))
      ? ['aws', 'sso', 'login', '--profile', awsProfile(login)]
      : null,
  logoutCommand: (login) =>
    login.config.sso
      ? ['aws', 'sso', 'logout', '--profile', awsProfile(login)]
      : null,
  help: ({ help }) => help,
  // The secret's text (SecretString), as JSON: null for a binary secret,
  // which `--output text` would print as None. A field is a key of its JSON.
  secretCommand: (_login, { ref, field }) => ({
    argv: [
      'aws',
      'secretsmanager',
      'get-secret-value',
      '--secret-id',
      ref,
      '--query',
      'SecretString',
      '--output',
      'json',
    ],
    output: 'json',
    keys: field ? [field] : [],
  }),
  // ECR takes no fixed login: the username is AWS, the password a token of
  // the host's region (good for that region only), for 12 hours
  registryToken: (_login, host) => {
    const region = ecrRegion(host)
    if (!region) {
      throw new Error(
        'an aws login gets tokens for ECR registries only: the host must be <account>.dkr.ecr.<region>.amazonaws.com',
      )
    }
    return {
      argv: ['aws', 'ecr', 'get-login-password', '--region', region],
      username: 'AWS',
      hours: 12,
    }
  },
  facts: (login) => ({
    profile: awsProfile(login),
    ...(login.config.region || login.config.sso
      ? { region: login.config.region ?? login.config.sso!.region }
      : {}),
  }),
}
