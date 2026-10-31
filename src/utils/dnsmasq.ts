import { execa } from 'execa'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'

export const DNSMASQ_PORT = 53535
export const DNSMASQ_CONFIG_NAME = 'local-env.conf'

export const getDnsmasqPaths = (brewPrefix: string) => ({
  binary: join(brewPrefix, 'sbin', 'dnsmasq'),
  mainConfig: join(brewPrefix, 'etc', 'dnsmasq.conf'),
  configDir: join(brewPrefix, 'etc', 'dnsmasq.d'),
})

const setsPort = (file: string) =>
  readFileSync(file, 'utf8')
    .split('\n')
    .some((line) => /^\s*port\s*=/.test(line))

// dnsmasq refuses to start when `port` is set twice, so any other loaded config
// that sets it (often a leftover copy of ours) breaks the wildcard DNS
export const findConflictingDnsmasqConfigs = (brewPrefix: string) => {
  const { mainConfig, configDir } = getDnsmasqPaths(brewPrefix)
  const candidates = existsSync(configDir)
    ? readdirSync(configDir)
        .filter(
          (name) => name.endsWith('.conf') && name !== DNSMASQ_CONFIG_NAME,
        )
        .map((name) => join(configDir, name))
    : []
  if (existsSync(mainConfig)) candidates.unshift(mainConfig)
  return candidates.filter(setsPort)
}

// Same flags as the Homebrew service, so this sees the config launchd loads
export const testDnsmasqConfig = async (brewPrefix: string) => {
  const { binary, mainConfig, configDir } = getDnsmasqPaths(brewPrefix)
  const result = await execa(
    binary,
    ['--test', '-C', mainConfig, '-7', `${configDir},*.conf`],
    { reject: false, stdio: 'pipe', all: true },
  )
  return { ok: result.exitCode === 0, output: result.all?.trim() ?? '' }
}
