import { existsSync, unlinkSync } from 'fs'
import { execCompose, runCompose } from '../../utils/exec.js'
import { logger } from '../../utils/logger.js'
import { askConfirm, askText } from '../../utils/prompt.js'
import { ensureCertificate, getCertPaths } from '../certificate.js'
import { DEFAULT_CONFIG, parseDomain as parse } from '../config.js'
import { ensureWildcardDns, removeResolver } from '../dns.js'
import type { Setting } from './types.js'

// The services that read the domain from their environment
const DOMAIN_SERVICES = ['proxy-connector', 'dashboard']

// Recreates them with the new value; a stopped stack picks it up on start
const restartDomainServices = async () => {
  const { stdout } = await execCompose(
    ['ps', '--status', 'running', '--quiet', ...DOMAIN_SERVICES],
    { capture: true },
  )
  if (!stdout?.trim()) return
  await runCompose(
    'Applying the new domain',
    ['up', '-d', ...DOMAIN_SERVICES],
    {
      done: 'Proxy serves the new domain',
    },
  )
}

const cleanUpPreviousDomain = async (previous: string, yes: boolean) => {
  if (yes || (await askConfirm(`Remove the DNS setup of ${previous}?`, true))) {
    await removeResolver(previous)
  }

  const { certFile, keyFile } = getCertPaths(previous)
  if (!existsSync(certFile) && !existsSync(keyFile)) return
  if (
    yes ||
    (await askConfirm(`Remove the certificate of *.${previous}?`, false))
  ) {
    for (const file of [certFile, keyFile]) {
      if (existsSync(file)) unlinkSync(file)
    }
    logger.success(`Removed the certificate of *.${previous}`)
  }
}

export const domainSetting: Setting<'domain'> = {
  key: 'domain',
  title: 'Domain',
  parse,
  ask: async (current) => {
    const answer = await askText(
      `Domain for local services (${DEFAULT_CONFIG.domain} is recommended)`,
      current,
    )
    return parse(answer)
  },
  apply: async (domain, previous, { yes, review }) => {
    logger.group('Certificate')
    await ensureCertificate(domain, {
      askToReplace:
        review && !yes
          ? () =>
              askConfirm(
                `The certificate for *.${domain} is valid. Replace it anyway?`,
                false,
              )
          : undefined,
    })

    logger.group('DNS')
    await ensureWildcardDns(domain, yes)

    if (previous && previous !== domain) {
      logger.group(`Previous domain ${previous}`)
      await cleanUpPreviousDomain(previous, yes)
      await restartDomainServices()
    }
  },
}
