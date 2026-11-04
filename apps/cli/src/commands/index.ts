import { configCommand } from '#cli/commands/config.js'
import { doctorCommand } from '#cli/commands/doctor.js'
import { installCommand } from '#cli/commands/install.js'
import { proxyCommand } from '#cli/commands/proxy.js'
import { resetCommand } from '#cli/commands/reset.js'
import { setupCommand } from '#cli/commands/setup.js'
import { startCommand } from '#cli/commands/start.js'
import { statusCommand } from '#cli/commands/status.js'
import { stopCommand } from '#cli/commands/stop.js'
import { sourcesCommand } from '#cli/commands/sources.js'
import { updateCommand } from '#cli/commands/update.js'

export const commands = [
  setupCommand,
  startCommand,
  stopCommand,
  statusCommand,
  configCommand,
  updateCommand,
  sourcesCommand,
  installCommand,
  proxyCommand,
  doctorCommand,
  resetCommand,
]
