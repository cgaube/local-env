import { execa } from 'execa'
import { X509Certificate } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { execCompose } from '../utils/exec.js'
import { logger } from '../utils/logger.js'
import { runTask } from '../utils/task.js'
import { HOME_DIR } from './paths.js'

export const CERTS_DIR = join(HOME_DIR, 'services/proxy/certs')

// Renewed this long before it expires, so it never lapses between two starts
const RENEW_BEFORE_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

export const getCertPaths = (domain: string) => ({
  certFile: join(CERTS_DIR, `${domain}.crt`),
  keyFile: join(CERTS_DIR, `${domain}.key`),
})

export type CertificateCheck =
  | { state: 'valid' | 'expiring' | 'expired'; expires: Date }
  | { state: 'missing' | 'wrong-domain' | 'untrusted' }

// The CA that mkcert installed on this machine
const readMkcertCa = async () => {
  try {
    const { stdout } = await execa('mkcert', ['-CAROOT'])
    const file = join(stdout.trim(), 'rootCA.pem')
    return existsSync(file) ? new X509Certificate(readFileSync(file)) : null
  } catch {
    return null
  }
}

export const checkCertificate = async (
  domain: string,
): Promise<CertificateCheck> => {
  const { certFile, keyFile } = getCertPaths(domain)
  if (!existsSync(certFile) || !existsSync(keyFile)) return { state: 'missing' }

  const cert = new X509Certificate(readFileSync(certFile))
  if (!cert.checkHost(domain) || !cert.checkHost(`any.${domain}`)) {
    return { state: 'wrong-domain' }
  }

  // Signed by another CA, e.g. after mkcert was reinstalled: browsers reject it
  const ca = await readMkcertCa()
  if (ca && !cert.verify(ca.publicKey)) return { state: 'untrusted' }

  const expires = new Date(cert.validTo)
  const daysLeft = (expires.getTime() - Date.now()) / DAY_MS
  if (daysLeft <= 0) return { state: 'expired', expires }
  if (daysLeft <= RENEW_BEFORE_DAYS) return { state: 'expiring', expires }
  return { state: 'valid', expires }
}

const formatDate = (date: Date) => date.toISOString().slice(0, 10)

export const describeCertificate = (
  domain: string,
  check: CertificateCheck,
) => {
  switch (check.state) {
    case 'valid':
      return `*.${domain} valid until ${formatDate(check.expires)}`
    case 'expiring':
      return `*.${domain} expires on ${formatDate(check.expires)}`
    case 'expired':
      return `*.${domain} expired on ${formatDate(check.expires)}`
    case 'missing':
      return `No certificate for *.${domain}`
    case 'wrong-domain':
      return `The certificate doesn't cover *.${domain}`
    case 'untrusted':
      return `The certificate for *.${domain} isn't signed by this machine's mkcert CA`
  }
}

// Installs mkcert's CA in the system and browser trust stores. Idempotent;
// the first run may ask for a password through sudo.
export const installLocalCa = async () => {
  await execa('mkcert', ['-install'], {
    stdin: 'inherit',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  logger.success('Local certificate authority trusted')
}

// Removes mkcert's CA from the trust stores: every mkcert certificate on this
// machine, including other projects', stops being trusted
export const uninstallLocalCa = async () => {
  await execa('mkcert', ['-uninstall'], {
    stdin: 'inherit',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  logger.success('Local certificate authority removed from the trust stores')
}

const createCertificate = async (domain: string) => {
  mkdirSync(CERTS_DIR, { recursive: true })
  const { certFile, keyFile } = getCertPaths(domain)
  await runTask(
    `Creating a certificate for *.${domain}`,
    'mkcert',
    ['-cert-file', certFile, '-key-file', keyFile, domain, `*.${domain}`],
    { done: `Created a certificate for *.${domain}` },
  )
}

// nginx keeps the old certificate in memory until it reloads
const reloadProxy = async () => {
  try {
    // By compose service: the container name is free to change
    await execCompose(['kill', '--signal', 'HUP', 'nginx-proxy'], {
      capture: true,
    })
    logger.success('Proxy reloaded with the new certificate')
  } catch {
    // Not running: it loads the new certificate when it starts
  }
}

// Creates or renews the certificate when it can't be used as is. With
// `askToReplace`, a valid certificate can still be replaced on request.
// Returns whether a new certificate was created.
export const ensureCertificate = async (
  domain: string,
  { askToReplace }: { askToReplace?: () => Promise<boolean> } = {},
) => {
  const check = await checkCertificate(domain)
  const message = describeCertificate(domain, check)

  if (check.state === 'valid') {
    if (!askToReplace || !(await askToReplace())) {
      logger.success(message)
      return false
    }
  } else {
    logger.warn(message)
  }

  await createCertificate(domain)
  await reloadProxy()
  return true
}
