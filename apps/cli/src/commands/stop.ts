import { Command } from 'commander'
import { stopAgent } from '#cli/core/agent.js'
import { logger, runCompose } from '#cli/utils/index.js'

// Stacks installed through Dockhand are separate compose projects and keep running
export const stopCommand = new Command('stop')
  .description('Stop the proxy, Dockhand and the helper services')
  .alias('down')
  .action(async () => {
    try {
      await runCompose('Stopping services', ['down'], {
        done: 'Services stopped',
      })
      // With the services: `start` brings both back
      if (await stopAgent()) logger.success('Dashboard agent stopped')
    } catch (error) {
      logger.error('Error stopping services:', error)
      process.exit(1)
    }
  })
