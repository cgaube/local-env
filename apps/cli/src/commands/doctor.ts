import { Command } from 'commander'
import { execa } from 'execa'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { checkCertificate, describeCertificate } from '../core/certificate.js'
import { isValidDomain, normalizeDomain, readConfig } from '../core/config.js'
import { COMPOSE_FILE } from '../core/paths.js'
import { checkBuildPort, findFreePort } from '../core/settings/build-port.js'
import { dockhandApi } from '../providers/docker/api.js'
import { resolveTemplateCompose } from '../providers/docker/template-sync.js'
import {
  BUILD_CONTEXTS_DIR,
  listSources,
  readSourceContent,
  SOURCES_DIR,
  summarizeSourceContent,
} from '../sources/sources.js'
import {
  DNSMASQ_PORT,
  findConflictingDnsmasqConfigs,
  getBrewPrefix,
  getDnsmasqPaths,
  logger,
  testDnsmasqConfig,
} from '../utils/index.js'

type CheckLevel = 'pass' | 'warn' | 'fail'

interface CheckResult {
  level: CheckLevel
  message: string
}

// The URLs Dockhand reads templates from, or null when it isn't reachable
const readDockhandSourceUrls = async () => {
  try {
    const sources =
      await dockhandApi<{ url: string; enabled: boolean }[]>(
        '/templates/sources',
      )
    return sources
      .filter((source) => source.enabled)
      .map((source) => source.url)
  } catch {
    return null
  }
}

// HEAD of the clone and of its remote; a different remote HEAD means new
// commits that `local-env update` would pull
const checkRemote = async (name: string): Promise<CheckResult> => {
  const dir = join(SOURCES_DIR, name)
  const remote = await execa(
    'git',
    ['-C', dir, 'ls-remote', '--exit-code', 'origin', 'HEAD'],
    { reject: false, timeout: 10_000 },
  )
  if (remote.exitCode !== 0) {
    return {
      level: 'warn',
      message: `${name}: can't reach its repo to check for new commits`,
    }
  }
  const { stdout: local } = await execa('git', ['-C', dir, 'rev-parse', 'HEAD'])
  return remote.stdout.startsWith(local.trim())
    ? { level: 'pass', message: `${name}: no new commits` }
    : {
        level: 'warn',
        message: `${name}: new commits available. Run \`local-env update\`.`,
      }
}

const checkSources = async (): Promise<CheckResult[]> => {
  const names = listSources()
  const results: CheckResult[] = []

  // Folders that aren't git repos are skipped by every command
  const ignored = existsSync(SOURCES_DIR)
    ? readdirSync(SOURCES_DIR).filter(
        (entry) => !entry.startsWith('.') && !names.includes(entry),
      )
    : []
  for (const entry of ignored) {
    results.push({
      level: 'warn',
      message: `${entry}: not a git repo, ignored. Remove it from ${SOURCES_DIR}.`,
    })
  }
  if (names.length === 0) {
    return [
      ...results,
      {
        level: 'pass',
        message: 'No sources. Add one with `local-env sources add <repo>`.',
      },
    ]
  }

  const dockhandUrls = await readDockhandSourceUrls()
  for (const name of names) {
    results.push(await checkRemote(name))

    const content = readSourceContent(name)
    results.push(
      content.docker.length || content.ansible.length
        ? {
            level: 'pass',
            message: `${name}: ${summarizeSourceContent(content)}`,
          }
        : {
            level: 'warn',
            message: `${name}: no Docker templates or Ansible roles found`,
          },
    )

    if (dockhandUrls && content.docker.length) {
      results.push(
        // Without the ?v= version that makes Dockhand refetch a changed list
        dockhandUrls.some((url) =>
          url.split('?')[0]!.endsWith(`/${name}/templates.json`),
        )
          ? { level: 'pass', message: `${name}: shown in Dockhand` }
          : {
              level: 'fail',
              message: `${name}: not shown in Dockhand. Run \`local-env start\`.`,
            },
      )
    }
  }
  return results
}

const checkDockerProxy = async (): Promise<CheckResult> => {
  try {
    const { stdout } = await execa(
      'docker',
      [
        'compose',
        '-f',
        COMPOSE_FILE,
        'ps',
        '--status',
        'running',
        '--services',
        'nginx-proxy',
      ],
      { stdio: 'pipe' },
    )
    if (stdout.split('\n').includes('nginx-proxy')) {
      return { level: 'pass', message: 'nginx-proxy container is running.' }
    }
    return {
      level: 'warn',
      message: 'nginx-proxy container is not running (HTTPS probe may fail).',
    }
  } catch {
    return {
      level: 'warn',
      message:
        'Could not query Docker status (is Docker running?). HTTPS probe may fail.',
    }
  }
}

const checkDnsmasqConfig = async (): Promise<CheckResult> => {
  const brewPrefix = await getBrewPrefix()
  if (!brewPrefix || !existsSync(getDnsmasqPaths(brewPrefix).binary)) {
    return {
      level: 'warn',
      message: 'dnsmasq not found in Homebrew; skipping config check.',
    }
  }

  const { ok, output } = await testDnsmasqConfig(brewPrefix)
  if (ok) {
    return { level: 'pass', message: 'dnsmasq config is valid.' }
  }

  const conflicts = findConflictingDnsmasqConfigs(brewPrefix)
  const hint = conflicts.length
    ? ` These files also set \`port\`: ${conflicts.join(', ')}. Disable them or rerun \`local-env setup\`.`
    : ''
  return {
    level: 'fail',
    message: `dnsmasq can't start: ${output}.${hint}`,
  }
}

const checkWildcardDns = async (host: string): Promise<CheckResult> => {
  try {
    const { stdout } = await execa(
      'dig',
      ['+short', host, '@127.0.0.1', '-p', String(DNSMASQ_PORT)],
      { stdio: 'pipe' },
    )
    const records = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)

    if (records.includes('127.0.0.1')) {
      return {
        level: 'pass',
        message: `dnsmasq resolves ${host} to 127.0.0.1.`,
      }
    }
    return {
      level: 'fail',
      message: `dnsmasq did not return 127.0.0.1 for ${host}.`,
    }
  } catch {
    return {
      level: 'fail',
      message: `DNS query failed for ${host} against 127.0.0.1:${DNSMASQ_PORT}.`,
    }
  }
}

const checkSystemDns = async (host: string): Promise<CheckResult> => {
  if (process.platform === 'darwin') {
    try {
      const { stdout } = await execa(
        'dscacheutil',
        ['-q', 'host', '-a', 'name', host],
        { stdio: 'pipe' },
      )
      if (stdout.includes('ip_address: 127.0.0.1')) {
        return { level: 'pass', message: `System resolver resolves ${host}.` }
      }
      return {
        level: 'warn',
        message: `System resolver output did not show 127.0.0.1 for ${host}.`,
      }
    } catch {
      return {
        level: 'warn',
        message: 'Could not query macOS DNS cache with dscacheutil.',
      }
    }
  }

  return {
    level: 'warn',
    message: 'System resolver check is currently implemented only for macOS.',
  }
}

const checkHttpsProbe = async (host: string): Promise<CheckResult> => {
  try {
    await execa('curl', ['-fsSkL', '--max-time', '5', `https://${host}/`], {
      stdio: 'pipe',
    })
    return {
      level: 'pass',
      message: `HTTPS probe succeeded for https://${host}/`,
    }
  } catch {
    return {
      level: 'warn',
      message: `HTTPS probe failed for https://${host}/ (start services and check VIRTUAL_HOST).`,
    }
  }
}

// ${HOST_HOME}/dev/app.ini, $HOST_HOME/dev: the path after the home folder
const HOST_HOME_PATH = /\$\{?HOST_HOME\}?(\/[^\s:'"]*)/g

// What templates need to deploy: the build port, each source's build-context
// repo, and the Mac files they mount
const checkTemplates = async (): Promise<CheckResult[]> => {
  const results: CheckResult[] = []
  const { buildPort } = readConfig()
  const state = await checkBuildPort(buildPort)
  if (state === 'ours') {
    results.push({
      level: 'pass',
      message: `Templates that build can reach local-env (port ${buildPort})`,
    })
  } else if (state === 'free') {
    results.push({
      level: 'warn',
      message: `Templates that build can't reach local-env: it isn't running. Run \`local-env start\`.`,
    })
  } else {
    const free = findFreePort(buildPort + 1)
    results.push({
      level: 'fail',
      message: `Port ${buildPort} is used by another program, so templates that build won't deploy.${free ? ` Run \`local-env config set buildPort ${free}\`.` : ''}`,
    })
  }

  for (const name of listSources()) {
    const folders = readSourceContent(name).docker
    if (folders.length === 0) continue
    results.push(
      existsSync(join(BUILD_CONTEXTS_DIR, `${name}.git`, 'info/refs'))
        ? { level: 'pass', message: `${name}: ready to build` }
        : {
            level: 'warn',
            message: `${name}: not ready to build yet. Run \`local-env start\`.`,
          },
    )

    for (const folder of folders) {
      const path = resolveTemplateCompose(`${name}/${folder}`)
      if (!path) continue
      const compose = readFileSync(path, 'utf8')
      for (const [, rest] of compose.matchAll(HOST_HOME_PATH)) {
        if (existsSync(join(homedir(), rest!))) continue
        results.push({
          level: 'warn',
          message: `${name}/${folder} mounts ~${rest}, which doesn't exist: Docker would create an empty folder there. Create it before deploying.`,
        })
      }
    }
  }
  return results
}

export const doctorCommand = new Command('doctor')
  .description('Run local proxy DNS/HTTPS diagnostics')
  .option(
    '-d, --domain <domain>',
    'Domain override (defaults to the domain in config.json)',
  )
  .option('-H, --host <host>', 'Host to probe over DNS/HTTPS checks')
  .option('--https', 'Run HTTPS probe (use with --host)')
  .action(async (options) => {
    const failures: CheckResult[] = []
    const warnings: CheckResult[] = []
    let totalChecks = 0

    const addResult = (result: CheckResult) => {
      totalChecks += 1
      if (result.level === 'pass') {
        logger.success(result.message)
        return
      }

      if (result.level === 'warn') {
        warnings.push(result)
        logger.warn(result.message)
        return
      }

      failures.push(result)
      logger.error(result.message)
    }

    try {
      const rootDomain = normalizeDomain(options.domain ?? readConfig().domain)
      if (!isValidDomain(rootDomain)) {
        logger.error(
          `Invalid domain "${rootDomain}". Expected a domain like "dev.test".`,
        )
        process.exit(1)
      }

      const host = options.host ?? `doctor.${rootDomain}`

      logger.info(`Domain ${rootDomain}, probe host ${host}`)

      logger.group('Certificates')
      const certificate = await checkCertificate(rootDomain)
      addResult({
        level:
          certificate.state === 'valid'
            ? 'pass'
            : certificate.state === 'expiring'
              ? 'warn'
              : 'fail',
        message:
          certificate.state === 'valid' || certificate.state === 'expiring'
            ? describeCertificate(rootDomain, certificate)
            : `${describeCertificate(rootDomain, certificate)}. Run \`local-env start\` or \`local-env setup\` to create it.`,
      })

      logger.group('DNS')
      if (process.platform === 'darwin') {
        const resolverPath = `/etc/resolver/${rootDomain}`
        if (!existsSync(resolverPath)) {
          addResult({
            level: 'fail',
            message: `Missing resolver file: ${resolverPath}`,
          })
        } else {
          const resolverContent = readFileSync(resolverPath, 'utf8')
          const hasNameserver = resolverContent.includes('nameserver 127.0.0.1')
          const hasPort = resolverContent.includes(`port ${DNSMASQ_PORT}`)
          addResult({
            level: hasNameserver && hasPort ? 'pass' : 'fail',
            message:
              hasNameserver && hasPort
                ? `Resolver file looks correct: ${resolverPath}`
                : `Resolver file is present but does not contain expected values: ${resolverPath}`,
          })
        }
      } else {
        addResult({
          level: 'warn',
          message:
            'Resolver file checks are currently implemented only for macOS.',
        })
      }

      addResult(await checkDnsmasqConfig())
      addResult(await checkWildcardDns(host))
      addResult(await checkSystemDns(host))

      logger.group('Proxy')
      addResult(await checkDockerProxy())

      if (options.https) {
        if (!options.host) {
          addResult({
            level: 'warn',
            message:
              'HTTPS probe requested without --host; skipping HTTPS check.',
          })
        } else {
          addResult(await checkHttpsProbe(host))
        }
      }

      logger.group('Sources')
      for (const result of await checkSources()) addResult(result)

      logger.group('Templates')
      for (const result of await checkTemplates()) addResult(result)

      logger.group('Summary')
      logger.success(
        `${totalChecks - failures.length - warnings.length} passed, ${warnings.length} warning(s), ${failures.length} failed`,
      )

      if (failures.length > 0) {
        process.exit(1)
      }
    } catch (error) {
      logger.error('Doctor failed:', error)
      process.exit(1)
    }
  })
