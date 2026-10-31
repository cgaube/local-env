import { Command } from 'commander'
import { logger, runCompose } from '../utils/index.js'

// Stacks installed through Dockhand are separate compose projects and keep running
export const stopCommand = new Command('stop')
  .description('Stop the proxy, Dockhand and the helper services')
  .alias('down')
  .action(async () => {
    try {
      await runCompose('Stopping services', ['down'], {
        done: 'Services stopped',
      })
    } catch (error) {
      logger.error('Error stopping services:', error)
      process.exit(1)
    }
  })
