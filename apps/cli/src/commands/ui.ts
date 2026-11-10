import { log } from '@clack/prompts'
import { Command } from 'commander'
import { styleText } from 'node:util'
import { galaxyLine } from '#cli/core/galaxy-collections.js'
import { renderPlaybook } from '#cli/core/playbook-output.js'
import { closeFrameWithCallout, logger } from '#cli/utils/logger.js'
import {
  askConfirm,
  askPassword,
  askSelect,
  askText,
  canAsk,
} from '#cli/utils/prompt.js'
import { runStep } from '#cli/utils/task.js'

// Ansible's events (ansible.posix.jsonl) for a sample run: what
// playbook-output.ts reads from `local-env install`
async function* sampleEvents() {
  const task = (
    role: string,
    name: string,
    event: string,
    host: Record<string, unknown>,
  ) => {
    const full = { name: `${role} : ${name}` }
    return [
      { _event: 'v2_playbook_on_task_start', task: full },
      { _event: event, task: full, hosts: { localhost: host } },
    ]
  }
  const events = [
    { _event: 'v2_playbook_on_play_start', play: { name: 'local-env tools' } },
    ...task('acme.tools.git', 'Install git', 'v2_runner_on_ok', {
      changed: false,
      msg: 'Package already installed: git',
    }),
    ...task('acme.tools.git', 'Install git-extras', 'v2_runner_on_ok', {
      changed: true,
      msg: 'Package installed: git-extras',
    }),
    ...task(
      'acme.tools.git',
      'Configure the pager',
      'v2_runner_on_skipped',
      {},
    ),
    ...task('acme.tools.node', 'Install Node.js', 'v2_runner_on_failed', {
      msg: 'Error: No available formula with the name "nodee"',
    }),
  ]
  for (const event of events) yield JSON.stringify(event)
}

// Every piece of the CLI's output, to see them together while changing one:
// ours (utils/logger.ts, utils/callout.ts, the task lines) and clack's own.
// Hidden from --help: it is for working on local-env.
export const uiCommand = new Command('ui')
  .description('Show every piece of the CLI output (for working on local-env)')
  .option('--prompts', 'Run the questions instead (needs a terminal)', false)
  .action(async (options: { prompts: boolean }) => {
    // The questions alone: they wait for answers (utils/prompt.ts)
    if (options.prompts) {
      if (!canAsk()) {
        logger.error(
          '--prompts needs a terminal: the questions wait for answers.',
        )
        process.exit(1)
      }
      await askSelect('askSelect', [
        { value: 'one', label: 'One', hint: 'a hint' },
        { value: 'two', label: 'Two' },
      ])
      await askConfirm('askConfirm', true)
      await askText('askText', 'a default')
      await askPassword('askPassword: typed masked')
      return
    }

    logger.group('Our lines, in a group (logger)')
    logger.log('logger.log: a plain line')
    logger.success('logger.success: what went well, plain')
    logger.info('logger.info: a detail, dimmed')
    logger.warn('logger.warn: something to look at')
    logger.error('logger.error: something that failed')
    logger.hint('logger.hint: a dim footer, set apart')

    logger.step('logger.step: a step of its own that went well')

    logger.group('Another program takes the terminal (session.ts: a login)')
    logger.handOver(
      'logger.handOver: acme-dev: the AWS CLI opens your browser to log in',
      'aws sso login --profile local-env-acme-acme-dev',
    )
    process.stdout.write('(the vendor CLI writes here, outside the frame)\n')
    logger.takeBack()
    logger.success(
      'logger.takeBack, then: acme-dev (AWS 123456789012 (Dev)): logged in as …',
    )

    logger.group('Task lines (playbook-output.ts, galaxy-collections.ts)')
    logger.info('A group per role, its label as the title:')
    await renderPlaybook(
      sampleEvents(),
      new Map([
        ['acme.tools.git', 'Git'],
        ['acme.tools.node', 'Node.js'],
      ]),
    )
    logger.group('Collections from Galaxy')
    logger.log(galaxyLine('geerlingguy.mac', '5.1.0', true))
    logger.log(galaxyLine('community.general', '13.5.0', false))

    // Each level, padded then compact, plain then tinted
    for (const level of ['info', 'success', 'warn', 'error'] as const) {
      logger.callout(
        level,
        `Callout: ${level}\nThe text after a bar of the level's color.\nPadded: a bar line above and below.`,
      )
    }
    logger.callout(
      'info',
      'Callout: compact (padded: false)\nNo bar line around the text.',
      { padded: false },
    )
    logger.callout(
      'success',
      'Callout: tinted\nThe text in the title color, dimmed.',
      { tinted: true },
    )

    logger.group("clack's own (@clack/prompts)")
    log.info('log.info')
    log.success('log.success')
    log.step('log.step: the group title above is one')
    log.warn('log.warn')
    log.error('log.error')
    log.message('log.message, with our symbol', {
      symbol: styleText('cyan', '~'),
    })
    // A spinner needs a terminal to redraw (runStep skips it otherwise)
    if (process.stdout.isTTY) {
      await runStep('runStep: a spinner with the time spent', () =>
        Bun.sleep(1500),
      )
      logger.success('The spinner clears itself when the step ends')
    }
    logger.box('logger.box (clack note)\nA summary in a box.\nUsed sparingly.')

    // In place of main.ts's "Done": the frame closes under it
    closeFrameWithCallout(
      'success',
      'closeFrameWithCallout\nThe last callout closes the frame with its corner.',
      { tinted: true },
    )
  })
