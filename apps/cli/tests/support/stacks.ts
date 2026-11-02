// A stack deployed from a source's template and linked to it, the starting
// point of the sync and update tests
import {
  buildDockhandStack,
  provisionedDockhand,
} from './factories/dockhand.js'
import { buildTemplate } from './factories/template.js'
import { machineReady } from './machine.js'
import { createCli } from './run-cli.js'

export const MAIL_V1 = [
  'name: mail',
  'services:',
  '  mail:',
  '    image: axllent/mailpit:v1',
  '    environment:',
  '      VIRTUAL_HOST: mail',
  "      VIRTUAL_PORT: '8025'",
  '',
].join('\n')

// The next version of the template: a new image
export const MAIL_V2 = MAIL_V1.replace('mailpit:v1', 'mailpit:v2')

// A line the user added to the deployed stack
export const withUserEdit = (compose: string) =>
  compose.replace(
    "      VIRTUAL_PORT: '8025'\n",
    "      VIRTUAL_PORT: '8025'\n      MP_MAX_MESSAGES: '500'\n",
  )

// The acme source with the mail template, and a mail stack deployed from it
// (`content`, MAIL_V1 by default). `sources sync` has run once: the stack is
// linked to acme/mail. Call `cli.createSource` options through `source`.
export const createLinkedStack = async ({
  content = MAIL_V1,
  files = {},
}: {
  content?: string
  // More files in the source, e.g. a build folder
  files?: Record<string, string>
} = {}) => {
  const cli = await createCli({ dockhand: provisionedDockhand() })
  cli.home.seedConfig()
  cli.home.seedCertificate()
  machineReady(cli)
  const repo = cli.createSource('acme', {
    templates: [buildTemplate({ folder: 'mail', compose: MAIL_V1 })],
  })
  if (Object.keys(files).length > 0) repo.commit(files, 'add files')
  await cli.run(['sources', 'add', repo.dir])
  cli.dockhand.state.stacks.push(buildDockhandStack({ name: 'mail', content }))

  const linked = await cli.run(['sources', 'sync', '--yes'])
  if (linked.exitCode !== 0) throw new Error(linked.output)

  // A new version of the template, pushed by its author
  const publish = (compose: string) =>
    repo.commit({ 'docker/mail/compose.yaml': compose }, 'new version')

  const stack = () => cli.dockhand.state.stacks.find((s) => s.name === 'mail')!
  const link = () =>
    cli.home.readJson<Record<string, Record<string, unknown>>>(
      'volumes/template-links.json',
    ).mail

  return { cli, repo, publish, stack, link }
}
