import { configCommand } from './config.js'
import { doctorCommand } from './doctor.js'
import { proxyCommand } from './proxy.js'
import { resetCommand } from './reset.js'
import { setupCommand } from './setup.js'
import { startCommand } from './start.js'
import { statusCommand } from './status.js'
import { stopCommand } from './stop.js'
import { sourcesCommand } from './sources.js'
import { updateCommand } from './update.js'

export const commands = [
  setupCommand,
  startCommand,
  stopCommand,
  statusCommand,
  configCommand,
  updateCommand,
  sourcesCommand,
  proxyCommand,
  doctorCommand,
  resetCommand,
]
