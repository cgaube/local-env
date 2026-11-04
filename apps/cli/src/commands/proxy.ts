import { Command } from 'commander'
import { routesCommand } from '#cli/commands/proxy/routes.js'

export const proxyCommand = new Command('proxy').description(
  'Inspect and manage the nginx proxy',
)

proxyCommand.addCommand(routesCommand)
