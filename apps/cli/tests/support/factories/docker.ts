// Rows the Docker CLI prints, for the fake docker's replies
import { TEST_DOMAIN } from './config.js'

// One row of `docker compose ps --format json`
export const buildComposeService = ({
  service = 'dockhand',
  name = `local-env-${service}-1`,
  state = 'running',
  health = '',
  ports = [],
}: {
  service?: string
  name?: string
  state?: string
  health?: string
  ports?: number[]
} = {}) => ({
  Name: name,
  Service: service,
  State: state,
  Health: health,
  Publishers: ports.map((port) => ({ PublishedPort: port })),
})

// `docker compose ps --format json` prints one JSON object per line
export const jsonLines = (rows: unknown[]) =>
  rows.map((row) => JSON.stringify(row)).join('\n')

// One entry of volumes/proxy/routes.json, as proxy-connector writes it
export const buildRoute = ({
  host = 'mail',
  container = `${host}-${host}-1`,
  stack = host,
  port = '80',
  status = 'running',
}: {
  host?: string
  container?: string
  stack?: string | null
  port?: string
  status?: string
} = {}) => ({
  hosts: [`${host}.${TEST_DOMAIN}`],
  url: `https://${host}.${TEST_DOMAIN}`,
  container,
  stack,
  port,
  status,
})
