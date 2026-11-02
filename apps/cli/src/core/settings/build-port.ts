import { execCompose, runCompose } from '../../utils/exec.js'
import { logger } from '../../utils/logger.js'
import { askText } from '../../utils/prompt.js'
import { DEFAULT_CONFIG, parseBuildPort as parse } from '../config.js'
import type { Setting } from './types.js'

// catalog-server serves template build folders to Docker's builder on this
// port of 127.0.0.1 (services/catalog-server/template-compose.ts). Stacks that
// build have it in their compose file, so it is picked once and kept.

const SERVICE = 'catalog-server'

const isFree = (port: number) => {
  try {
    const server = Bun.listen({
      hostname: '127.0.0.1',
      port,
      socket: { data() {} },
    })
    server.stop(true)
    return true
  } catch {
    return false
  }
}

// The port catalog-server publishes now, when it runs
const publishedPort = async () => {
  try {
    const { stdout } = await execCompose(
      ['ps', '--status', 'running', '--format', 'json', SERVICE],
      { capture: true },
    )
    const [row] = (stdout ?? '').split('\n').filter(Boolean)
    if (!row) return null
    const { Publishers } = JSON.parse(row) as {
      Publishers: { PublishedPort: number }[] | null
    }
    return Publishers?.find((item) => item.PublishedPort)?.PublishedPort ?? null
  } catch {
    return null
  }
}

export type PortState = 'free' | 'ours' | 'taken'

export const checkBuildPort = async (port: number): Promise<PortState> => {
  if ((await publishedPort()) === port) return 'ours'
  return isFree(port) ? 'free' : 'taken'
}

export const findFreePort = (from: number) => {
  for (let port = from; port < from + 100 && port <= 65535; port += 1) {
    if (isFree(port)) return port
  }
  return null
}

// Recreates catalog-server on the new port; a stopped stack picks it up on
// start
const restartCatalogServer = async () => {
  if ((await publishedPort()) === null) return
  await runCompose('Moving the build port', ['up', '-d', SERVICE], {
    done: 'catalog-server listens on the new build port',
  })
}

export const buildPortSetting: Setting<'buildPort'> = {
  key: 'buildPort',
  title: 'Build port',
  parse,
  ask: async (current) => {
    // Suggests a free one when another program holds the current port
    const suggestion =
      (await checkBuildPort(current)) === 'taken'
        ? (findFreePort(current + 1) ?? current)
        : current
    const answer = await askText(
      `Port for template builds (${DEFAULT_CONFIG.buildPort} by default)`,
      String(suggestion),
    )
    return parse(answer)
  },
  apply: async (port, previous) => {
    logger.group('Build port')
    if ((await checkBuildPort(port)) === 'taken') {
      const free = findFreePort(port + 1)
      logger.warn(
        `Port ${port} is used by another program: templates that build won't deploy.${free ? ` Run \`local-env config set buildPort ${free}\`.` : ''}`,
      )
      return
    }
    if (previous !== null && previous !== port) {
      await restartCatalogServer()
      logger.info(
        'Stacks that build get the new address on the next `local-env update`',
      )
      return
    }
    logger.success(`Template builds use 127.0.0.1:${port}`)
  },
}
