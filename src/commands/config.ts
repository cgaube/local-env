import { Command } from 'commander'
import { existsSync, readFileSync } from 'fs'
import { styleText } from 'node:util'
import {
  checkConfig,
  CONFIG_PATH,
  readConfig,
  writeConfig,
} from '../core/config.js'
import { findSetting, settings } from '../core/settings/index.js'
import { logger } from '../utils/index.js'

const KEYS = settings.map((setting) => setting.key).join(', ')

const requireSetting = (key: string) => {
  const setting = findSetting(key)
  if (!setting) {
    logger.error(`Unknown setting "${key}". Use one of: ${KEYS}`)
    process.exit(1)
  }
  return setting
}

// Keys actually written in config.json; the others use their default
const readStoredKeys = () => {
  if (!existsSync(CONFIG_PATH)) return []
  try {
    return Object.keys(JSON.parse(readFileSync(CONFIG_PATH, 'utf8')))
  } catch {
    return []
  }
}

const getCommand = new Command('get')
  .description('Show the settings, or one of them')
  .argument('[key]', `One of: ${KEYS}`)
  .action((key?: string) => {
    const config = readConfig()
    if (key !== undefined) {
      const value = String(config[requireSetting(key).key])
      // Bare value for scripts: $(local-env config get domain)
      if (process.stdout.isTTY) logger.log(value)
      else console.log(value)
      return
    }

    const stored = readStoredKeys()
    const width = Math.max(...settings.map((setting) => setting.title.length))
    logger.log(
      settings
        .map((setting) => {
          const value = String(config[setting.key])
          const note = stored.includes(setting.key)
            ? ''
            : styleText('dim', ' (default)')
          return `${setting.title.padEnd(width)}  ${styleText('cyan', value)}${note}`
        })
        .join('\n'),
    )
    if (!existsSync(CONFIG_PATH)) {
      logger.hint('Not set up yet: run `local-env setup`')
    }
  })

const setCommand = new Command('set')
  .description('Change a setting and apply it (certificate, DNS, proxy)')
  .argument('<key>', `One of: ${KEYS}`)
  .argument('<value>')
  .option('--no-apply', 'Only save the value in config.json')
  .action(async (key: string, value: string, options: { apply: boolean }) => {
    try {
      const setting = requireSetting(key)
      // Repairs an invalid value: there is no previous one to clean up
      const { config, errors } = checkConfig()
      for (const { message } of errors) {
        logger.warn(`${CONFIG_PATH}: ${message}`)
      }
      const invalid = errors.some((error) => error.key === setting.key)
      const previous = invalid ? null : config[setting.key]
      const next = setting.parse(value)

      if (next !== previous) {
        writeConfig({ [setting.key]: next })
        logger.success(`${setting.key} set to ${next} in ${CONFIG_PATH}`)
      } else {
        logger.info(`${setting.key} is already ${next}`)
      }

      // Also on an unchanged value: repairs an expired certificate or DNS
      if (options.apply) {
        await setting.apply(next, previous, { yes: false, review: false })
      }
    } catch (error) {
      logger.error('Could not change the setting:', error)
      process.exit(1)
    }
  })

export const configCommand = new Command('config')
  .description(`Read or change the settings in ${CONFIG_PATH}`)
  .addCommand(getCommand)
  .addCommand(setCommand)
