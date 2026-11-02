import { execa } from 'execa'
import { Command } from 'commander'
import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { styleText } from 'node:util'
import { join } from 'path'
import { checkCertificate, describeCertificate } from '../core/certificate.js'
import { CONFIG_PATH, readConfig } from '../core/config.js'
import { COMPOSE_FILE, HOME_DIR } from '../core/paths.js'
import {
  getSourceUrl,
  listSources,
  readSourceContent,
  summarizeSourceContent,
} from '../sources/sources.js'
import { execCompose, isDockerRunning, logger } from '../utils/index.js'

const ROUTES_FILE = join(HOME_DIR, 'volumes/proxy/routes.json')
// The compose project of the core services
const CORE_STACK = 'local-env'

const shortenHome = (path: string) => path.replace(homedir(), '~')

type Route = {
  url: string
  container: string
  stack: string | null
  status: string
}

// Listed in full by `local-env proxy routes` and the dashboard
const MAX_ROUTES = 10

const stateColor = (state: string) =>
  state === 'running' || state === 'healthy'
    ? 'green'
    : state === 'starting' || state === 'restarting'
      ? 'yellow'
      : 'red'

const readRoutes = (): Route[] => {
  try {
    return JSON.parse(readFileSync(ROUTES_FILE, 'utf8'))
  } catch {
    return []
  }
}

type ComposeService = {
  Name: string
  Service: string
  State: string
  Health: string
  Publishers: { PublishedPort: number }[] | null
}

// The `local-env.description` label of each core service, as the dashboard
// shows it
const readDescriptions = () => {
  try {
    const compose = Bun.YAML.parse(readFileSync(COMPOSE_FILE, 'utf8')) as {
      services?: Record<string, { labels?: Record<string, unknown> }>
    }
    return Object.fromEntries(
      Object.entries(compose.services ?? {}).map(([name, service]) => [
        name,
        String(service.labels?.['local-env.description'] ?? ''),
      ]),
    )
  } catch {
    return {}
  }
}

// Same as the dashboard: the service's route, its only published port, or
// its ports
const serviceLink = (service: ComposeService, routes: Route[]) => {
  const route = routes.find((item) => item.container === service.Name)
  if (route) return route.url
  const ports = [
    ...new Set(
      (service.Publishers ?? [])
        .map((publisher) => publisher.PublishedPort)
        .filter(Boolean),
    ),
  ].sort((a, b) => a - b)
  if (ports.length === 1) return `http://localhost:${ports[0]}`
  return ports.length ? `ports ${ports.join(', ')}` : ''
}

const showServices = async () => {
  logger.group('Core services')
  if (!(await isDockerRunning())) {
    logger.warn('Docker is not running')
    return { running: false, dockhand: null }
  }

  const { stdout } = await execCompose(['ps', '--all', '--format', 'json'], {
    capture: true,
  })
  const services = (stdout ?? '')
    .split('\n')
    .filter(Boolean)
    .map((row) => JSON.parse(row) as ComposeService)
    .sort((a, b) => a.Service.localeCompare(b.Service))
  if (services.length === 0) {
    logger.warn('Not started. Run `local-env start`.')
    return { running: false, dockhand: null }
  }

  const routes = readRoutes()
  const descriptions = readDescriptions()
  const links = services.map((service) => serviceLink(service, routes))
  const nameWidth = Math.max(
    ...services.map((service) => service.Service.length),
  )
  const linkWidth = Math.max(...links.map((link) => link.length))
  const rows = services.map((service, index) => {
    const state = service.Health || service.State
    return [
      service.Service.padEnd(nameWidth),
      styleText(stateColor(state), state.padEnd(9)),
      links[index]!.padEnd(linkWidth),
      styleText('dim', descriptions[service.Service] ?? ''),
    ]
      .join('  ')
      .trimEnd()
  })
  logger.log(rows.join('\n'))
  const dockhand = services.findIndex(
    (service) => service.Service === 'dockhand',
  )
  return {
    running: services.some((service) => service.State === 'running'),
    // Where to see the other containers
    dockhand: links[dockhand]?.startsWith('http') ? links[dockhand] : null,
  }
}

const showDomain = async () => {
  logger.group('Domain')
  if (!existsSync(CONFIG_PATH)) {
    logger.warn('Not set up yet. Run `local-env setup`.')
    return
  }
  const { domain } = readConfig()
  const certificate = await checkCertificate(domain)
  const message = `${domain}: ${describeCertificate(domain, certificate)}`
  if (certificate.state === 'valid') logger.success(message)
  else logger.warn(message)
}

const showSources = async () => {
  logger.group('Sources')
  const names = listSources()
  if (names.length === 0) {
    logger.info('None. Add one with `local-env sources add <repo>`.')
    return
  }
  const width = Math.max(...names.map((name) => name.length))
  for (const name of names) {
    const content = summarizeSourceContent(readSourceContent(name))
    const url = await getSourceUrl(name).catch(() => 'no remote')
    logger.success(`${name.padEnd(width)}  ${content}  ${shortenHome(url)}`)
  }
}

// Running containers outside the core stack that have no route: databases,
// workers, other projects. Only counted: `docker ps` and Dockhand list them.
const countUnrouted = async (routes: Route[]) => {
  const { stdout } = await execa('docker', [
    'ps',
    '--format',
    '{{.Names}}\t{{.Label "com.docker.compose.project"}}',
  ])
  const routed = new Set(routes.map((route) => route.container))
  return stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t'))
    .filter(([name, project]) => project !== CORE_STACK && !routed.has(name!))
    .length
}

const showRoutes = async (running: boolean, dockhand: string | null) => {
  logger.group('Routes')
  if (!running || !existsSync(ROUTES_FILE)) {
    logger.info('None while the proxy is stopped')
    return
  }
  // Like the dashboard: the core services are listed above
  const routes = readRoutes().filter((route) => route.stack !== CORE_STACK)
  const dashboard = `https://local-env.${readConfig().domain}`
  const unrouted = await countUnrouted(routes)
  const others = unrouted
    ? styleText(
        'dim',
        `${unrouted} other container${unrouted === 1 ? '' : 's'} without a route: docker ps${dockhand ? `, or ${dockhand}` : ''}`,
      )
    : null
  if (routes.length === 0) {
    logger.info(`None. Add a VIRTUAL_HOST to a container: see ${dashboard}`)
    if (others) logger.log(others)
    return
  }

  const shown = routes.slice(0, MAX_ROUTES)
  const urlWidth = Math.max(...shown.map((route) => route.url.length))
  const stackWidth = Math.max(
    ...shown.map((route) => (route.stack ?? route.container).length),
  )
  const rows = shown.map((route) =>
    [
      route.url.padEnd(urlWidth),
      (route.stack ?? route.container).padEnd(stackWidth),
      styleText(stateColor(route.status), route.status),
    ].join('  '),
  )
  if (routes.length > shown.length) {
    rows.push(
      styleText(
        'dim',
        `+${routes.length - shown.length} more: local-env proxy routes, or ${dashboard}`,
      ),
    )
  }
  if (others) rows.push(others)
  logger.log(rows.join('\n'))
}

export const statusCommand = new Command('status')
  .description('Show what is running, the domain, sources and routes')
  .option('--services', 'Only show the core services', false)
  .action(async (options: { services: boolean }) => {
    try {
      const { running, dockhand } = await showServices()
      if (options.services) return
      await showDomain()
      await showSources()
      await showRoutes(running, dockhand)
    } catch (error) {
      logger.error('Error checking status:', error)
      process.exit(1)
    }
  })
