import { Command } from 'commander'
import { routesCommand } from './proxy/routes.js'

export const proxyCommand = new Command('proxy').description(
  'Inspect and manage the nginx proxy',
)

proxyCommand.addCommand(routesCommand)
