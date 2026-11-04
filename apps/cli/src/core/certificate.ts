import { execa } from 'execa'
import { X509Certificate } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { execCompose } from '#cli/utils/exec.js'
import { logger } from '#cli/utils/logger.js'
import { runTask } from '#cli/utils/task.js'
import { HOME_DIR } from '#cli/core/paths.js'

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

// The file of the CA that mkcert created on this machine
const readMkcertCaFile = async () => {
  try {
    const { stdout } = await execa('mkcert', ['-CAROOT'])
    const file = join(stdout.trim(), 'rootCA.pem')
    return existsSync(file) ? file : null
  } catch {
    return null
  }
}

// The CA that mkcert installed on this machine
const readMkcertCa = async () => {
  const file = await readMkcertCaFile()
  return file ? new X509Certificate(readFileSync(file)) : null
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

const firstLine = (error: unknown) => {
  const text =
    error instanceof Error && 'stderr' in error && error.stderr
      ? String(error.stderr)
      : String(error instanceof Error ? error.message : error)
  const lines = text.split('\n').map((line) => line.trim())
  return lines.find((line) => line.startsWith('ERROR')) ?? lines[0] ?? ''
}

// Trust settings for the user only: no admin rights, so it works on managed
// Macs that block the system trust settings. Chrome, Safari and curl accept
// them. macOS shows a password dialog, so it needs a logged-in session.
const isTrustedForUser = async (caFile: string) => {
  const { exitCode } = await execa('security', ['verify-cert', '-c', caFile], {
    reject: false,
    stdio: 'ignore',
  })
  return exitCode === 0
}

const trustCaForUser = async (caFile: string) => {
  await execa('security', ['add-trusted-cert', '-r', 'trustRoot', caFile], {
    stdin: 'inherit',
    stdout: 'pipe',
    stderr: 'pipe',
  })
}

// mkcert touches only the Firefox (NSS) stores, never the system ones, which
// need sudo. macOS can block access to the Firefox profiles: mkcert then
// changes nothing and does not fail. Firefox also reads the trust of the
// macOS keychain when it starts, so the user trust is sufficient.
const mkcertInFirefox = (action: '-install' | '-uninstall') =>
  execa('mkcert', [action], {
    env: { TRUST_STORES: 'nss' },
    stdin: 'inherit',
    stdout: 'pipe',
    stderr: 'pipe',
  })

// Creates mkcert's CA if it is missing, and trusts it in Firefox and for the
// user. Idempotent: a CA that is already trusted asks for nothing. When a
// store refuses the CA, a callout gives the manual steps and setup continues:
// browsers show a warning until the CA is trusted.
export const installLocalCa = async () => {
  const failed: string[] = []
  try {
    await mkcertInFirefox('-install')
  } catch (error) {
    failed.push(`Firefox: ${firstLine(error)}`)
  }

  // Without a CA, nothing can be trusted or signed
  const caFile = await readMkcertCaFile()
  if (!caFile) {
    throw new Error(
      `mkcert could not create its certificate authority. ${failed.join(' ')}`,
    )
  }

  if (!(await isTrustedForUser(caFile))) {
    try {
      await trustCaForUser(caFile)
    } catch (error) {
      failed.push(`Login keychain: ${firstLine(error)}`)
    }
  }

  if (failed.length === 0) {
    logger.success('Local certificate authority trusted')
    return
  }
  logger.callout(
    'warn',
    [
      'The local certificate authority is not fully trusted',
      ...failed,
      'Browsers show a warning for local-env sites until you trust it. Try:',
      `  security add-trusted-cert -r trustRoot "${caFile}"`,
      '  TRUST_STORES=nss mkcert -install',
    ].join('\n'),
  )
}

// Removes mkcert's CA from the trust stores: every mkcert certificate on this
// machine, including other projects', stops being trusted. The system trust
// that older versions added stays: `mkcert -uninstall` removes it, with sudo.
export const uninstallLocalCa = async () => {
  const caFile = await readMkcertCaFile()
  if (caFile) {
    await execa('security', ['remove-trusted-cert', caFile], {
      reject: false,
      stdin: 'inherit',
      stdout: 'pipe',
      stderr: 'pipe',
    })
  }
  await mkcertInFirefox('-uninstall')
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
