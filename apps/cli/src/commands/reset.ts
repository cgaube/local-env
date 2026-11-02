import { Command } from 'commander'
import { execa } from 'execa'
import { existsSync, readdirSync, rmSync } from 'fs'
import { join } from 'path'
import { uninstallLocalCa } from '../core/certificate.js'
import { CONFIG_PATH, readConfig } from '../core/config.js'
import { removeWildcardDns } from '../core/dns.js'
import { HOME_DIR, isCheckout } from '../core/paths.js'
import { askConfirm, isDockerRunning, logger, runTask } from '../utils/index.js'

const PROJECT = 'local-env'
const NETWORK = 'local-env'
// Created by proxy-connector: routed host names for calls between containers
const HOSTS_NETWORK = 'local-env-hosts'
// Built or pulled only for local-env. The shared base images (nginx:alpine,
// oven/bun) stay: other projects may use them.
const IMAGES = [
  'local-env-nginx-proxy',
  'local-env-dashboard',
  'fnsys/dockhand',
  // Proxy image of older versions
  'jwilder/nginx-proxy',
]
const LOCAL_IMAGE_PREFIX = 'local-env/'
// Dockhand keeps the stacks it deploys under /app/data
const DOCKHAND_STACKS_DIR = '/app/data/'

const lines = async (args: string[]) => {
  const { stdout } = await execa('docker', args)
  return stdout.split('\n').filter(Boolean)
}

// Compose projects deployed through Dockhand
const findDeployedStacks = async () => {
  const rows = await lines([
    'ps',
    '--all',
    '--format',
    '{{.Label "com.docker.compose.project"}}\t{{.Label "com.docker.compose.project.working_dir"}}',
  ])
  const stacks = new Set<string>()
  for (const row of rows) {
    const [project, workingDir] = row.split('\t')
    if (!project || project === PROJECT) continue
    if (workingDir?.startsWith(DOCKHAND_STACKS_DIR)) {
      stacks.add(project)
    }
  }
  return [...stacks].sort()
}

// Containers of other projects that proxy-connector attached to the network
const findAttachedContainers = async (stacks: string[]) => {
  const rows = await lines([
    'ps',
    '--all',
    '--filter',
    `network=${NETWORK}`,
    '--format',
    '{{.Names}}\t{{.Label "com.docker.compose.project"}}',
  ])
  return rows
    .map((row) => row.split('\t'))
    .filter(([, project]) => project !== PROJECT && !stacks.includes(project!))
    .map(([name]) => name!)
}

const findImages = async () => {
  const present: string[] = []
  for (const image of IMAGES) {
    const { exitCode } = await execa('docker', ['image', 'inspect', image], {
      reject: false,
      stdio: 'ignore',
    })
    if (exitCode === 0) present.push(image)
  }
  // Built from templates with `image: local-env/<name>`
  const built = await lines([
    'images',
    '--filter',
    `reference=${LOCAL_IMAGE_PREFIX}*`,
    '--format',
    '{{.Repository}}:{{.Tag}}',
  ])
  return [...present, ...built]
}

// In a checkout (LOCAL_ENV_HOME=.) only the runtime state goes, never the code
const homeTargets = () => {
  if (!isCheckout(HOME_DIR)) return existsSync(HOME_DIR) ? [HOME_DIR] : []

  const volumes = join(HOME_DIR, 'volumes')
  return [
    CONFIG_PATH,
    join(HOME_DIR, 'services/proxy/certs'),
    ...(existsSync(volumes)
      ? readdirSync(volumes)
          .filter((name) => name !== '.keep')
          .map((name) => join(volumes, name))
      : []),
  ].filter((path) => existsSync(path))
}

const showPlan = (plan: {
  docker: boolean
  stacks: string[]
  attached: string[]
  images: string[]
  home: string[]
  domain: string
}) => {
  logger.group('Will be removed')
  if (plan.docker) {
    for (const stack of plan.stacks) {
      logger.warn(
        `Stack ${stack}, with its volumes (data is lost) and built images`,
      )
    }
    logger.success(
      `Core services and the ${NETWORK} and ${HOSTS_NETWORK} networks`,
    )
    if (plan.images.length) logger.success(`Images: ${plan.images.join(', ')}`)
    for (const name of plan.attached) {
      logger.success(`${name}: disconnected from ${NETWORK}, not removed`)
    }
  } else {
    logger.warn('Docker is not running: containers and images are skipped')
  }
  for (const path of plan.home) logger.success(path)
  if (process.platform === 'darwin') {
    logger.success(`DNS for *.${plan.domain} (/etc/resolver, dnsmasq config)`)
  }

  logger.group('Kept')
  logger.info(
    'Homebrew packages (mkcert, nss, dnsmasq) and the local-env binary',
  )
  logger.info('Base images nginx:alpine and oven/bun')
  logger.info('The repos your sources were cloned from')
}

export const resetCommand = new Command('reset')
  .description(
    'Remove everything local-env created, to uninstall or start over',
  )
  .option('-y, --yes', 'Skip the confirmation (keeps the mkcert CA)', false)
  .option('--dry-run', 'Only show what would be removed', false)
  .action(async (options: { yes: boolean; dryRun: boolean }) => {
    try {
      const docker = await isDockerRunning()
      const stacks = docker ? await findDeployedStacks() : []
      const plan = {
        docker,
        stacks,
        attached: docker ? await findAttachedContainers(stacks) : [],
        images: docker ? await findImages() : [],
        home: homeTargets(),
        domain: readConfig().domain,
      }
      showPlan(plan)
      if (options.dryRun) return

      if (
        !options.yes &&
        !(await askConfirm('Remove all of this? It cannot be undone.', false))
      ) {
        logger.info('Nothing was removed')
        return
      }
      const removeCa =
        !options.yes &&
        (await askConfirm(
          "Also remove mkcert's CA from your trust stores? Other projects using mkcert would stop being trusted.",
          false,
        ))

      if (docker) {
        logger.group('Docker')
        // Otherwise it re-attaches the containers disconnected below, and the
        // network can't be removed
        await execa(
          'docker',
          ['compose', '-p', PROJECT, 'stop', 'proxy-connector'],
          { reject: false, stdio: 'ignore' },
        )
        for (const stack of stacks) {
          await runTask(
            `Removing ${stack}`,
            'docker',
            // --rmi local: also the images built for it, not the pulled ones
            [
              'compose',
              '-p',
              stack,
              'down',
              '--volumes',
              '--remove-orphans',
              '--rmi',
              'local',
            ],
            { done: `Removed stack ${stack}` },
          )
        }
        for (const name of plan.attached) {
          await execa('docker', ['network', 'disconnect', '-f', NETWORK, name])
          await execa(
            'docker',
            ['network', 'disconnect', '-f', HOSTS_NETWORK, name],
            { reject: false, stdio: 'ignore' },
          )
          logger.success(`Disconnected ${name}`)
        }
        await runTask(
          'Removing the core services',
          'docker',
          ['compose', '-p', PROJECT, 'down', '--volumes', '--remove-orphans'],
          { done: `Removed the core services and the ${NETWORK} network` },
        )
        await execa('docker', ['network', 'rm', HOSTS_NETWORK], {
          reject: false,
          stdio: 'ignore',
        })
        for (const image of plan.images) {
          const { exitCode } = await execa('docker', ['image', 'rm', image], {
            reject: false,
            stdio: 'ignore',
          })
          if (exitCode === 0) logger.success(`Removed image ${image}`)
          else logger.warn(`Kept image ${image}: another container uses it`)
        }
      }

      if (process.platform === 'darwin') {
        logger.group('DNS')
        await removeWildcardDns(plan.domain)
      }

      logger.group('Files')
      for (const path of plan.home) {
        rmSync(path, { recursive: true, force: true })
        logger.success(`Removed ${path}`)
      }

      if (removeCa) {
        logger.group('Certificate authority')
        await uninstallLocalCa()
      }

      logger.box(
        [
          'local-env was reset',
          'Run `local-env setup` to set it up again.',
        ].join('\n'),
      )
    } catch (error) {
      logger.error('Reset failed:', error)
      process.exit(1)
    }
  })
