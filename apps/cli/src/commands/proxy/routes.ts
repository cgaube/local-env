import { Command } from 'commander'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { HOME_DIR } from '../../core/paths.js'
import { execCompose, isDockerRunning, logger } from '../../utils/index.js'

// Written by services/proxy-connector from the running containers
const ROUTES_FILE = join(HOME_DIR, 'volumes/proxy/routes.json')

type Route = {
  hosts: string[]
  url: string
  container: string
  port: string
}

// By compose service: the container name is free to change
const isProxyRunning = async () => {
  const { stdout } = await execCompose(
    ['ps', '--status', 'running', '--services', 'nginx-proxy'],
    { capture: true },
  )
  return (stdout ?? '').split('\n').includes('nginx-proxy')
}

const renderRoutes = (routes: Route[]) => {
  const rows = routes.map((route) => ({
    host: route.hosts.join(','),
    name: route.container,
    port: route.port,
    url: route.url,
  }))

  const headers = {
    host: 'HOST',
    name: 'CONTAINER',
    port: 'PORT',
    url: 'URL',
  }

  const widths = {
    host: Math.max(headers.host.length, ...rows.map((r) => r.host.length)),
    name: Math.max(headers.name.length, ...rows.map((r) => r.name.length)),
    port: Math.max(headers.port.length, ...rows.map((r) => r.port.length)),
  }

  const format = (row: typeof headers) =>
    [
      row.host.padEnd(widths.host),
      row.name.padEnd(widths.name),
      row.port.padEnd(widths.port),
      row.url,
    ].join('  ')

  logger.log([format(headers), ...rows.map(format)].join('\n'))
}

export const routesCommand = new Command('routes')
  .description('List active proxy routes from running containers')
  .action(async () => {
    try {
      if (!(await isDockerRunning())) {
        logger.error('Docker is not running. Start Docker and retry.')
        process.exit(1)
      }
      if (!(await isProxyRunning()) || !existsSync(ROUTES_FILE)) {
        logger.warn(
          'The proxy is not running. Start it with `local-env start`.',
        )
        return
      }

      const routes = JSON.parse(readFileSync(ROUTES_FILE, 'utf8')) as Route[]
      if (routes.length === 0) {
        logger.info(
          'No active routes. Start a container with VIRTUAL_HOST to expose it.',
        )
        return
      }
      renderRoutes(routes)
    } catch (error) {
      logger.error('Error listing proxy routes:', error)
      process.exit(1)
    }
  })
