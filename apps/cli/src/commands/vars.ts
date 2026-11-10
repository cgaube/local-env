import { Command } from 'commander'
import { styleText } from 'node:util'
import { inputText, type WantedInput } from '#services/dashboard/role-graph.js'
import { readVariables, writeVariables } from '#services/dashboard/tools.js'
import {
  currentRoots,
  describeInputs,
  listCatalog,
  parseVariableText,
  questionOf,
  readAllInputs,
  readWantedInputs,
  TOOLS_DIR,
} from '#cli/core/tools.js'
import { logger } from '#cli/utils/index.js'
import { closeFrameWithCallout } from '#cli/utils/logger.js'
import {
  askConfirm,
  askMultiSelect,
  askSelect,
  askText,
  canAsk,
} from '#cli/utils/prompt.js'
import { mkdirSync } from 'fs'

// The values of the variables the tools take (meta/argument_specs.yml), in
// volumes/tools/variables.json: the same file as the dashboard's Variables
// sheet. One value per variable name, as Ansible's variables are global.

// A value as it is saved: text as is, the rest as JSON
const valueText = (value: unknown) =>
  typeof value === 'string' ? value : JSON.stringify(value)

const listCommand = new Command('list')
  .description('List the variables of your tools and their values')
  .action(() => {
    const catalog = listCatalog()
    const inputs = readWantedInputs(catalog, currentRoots(catalog))
    const values = readVariables(TOOLS_DIR)
    const used = new Set(inputs.map(({ name }) => name))
    const unused = Object.entries(values).filter(([name]) => !used.has(name))

    logger.group('Your tools')
    if (inputs.length === 0) logger.info('Your tools take no variables.')
    for (const line of describeInputs(inputs)) logger.log(line)
    if (unused.length > 0) {
      // Kept for a profile or a tool you no longer install
      logger.group('Saved')
      for (const [name, value] of unused) {
        logger.log(`${name}: ${styleText('dim', valueText(value))}`)
      }
    }
    logger.hint(
      'Change one with `local-env vars set <name> <value>`, or in the dashboard (Variables).',
    )
  })

// What `vars set` accepts for this input, for a message without a terminal
const accepted = (input: WantedInput) =>
  input.choices
    ? `one of: ${input.choices.join(', ')}`
    : input.type === 'bool'
      ? 'true or false'
      : input.type === 'list'
        ? 'a list as "a, b"'
        : input.type === 'dict'
          ? 'a JSON object'
          : input.type === 'int'
            ? 'a whole number'
            : 'a value'

// Asks for the value in the terminal, of its type: a select for choices, a
// yes/no for a bool, else text, filled with the saved value and checked
const askValue = async (input: WantedInput, saved: unknown) => {
  const message = questionOf(input.name, input.description)
  if (input.choices) {
    const choices = input.choices
    const value = await askSelect(
      message,
      choices.map((choice) => ({
        value: String(choice),
        label: String(choice),
        ...(choice === saved
          ? { hint: 'saved' }
          : choice === input.default
            ? { hint: 'default' }
            : {}),
      })),
    )
    return choices.find((choice) => String(choice) === value)
  }
  if (input.type === 'bool') {
    return askConfirm(message, (saved ?? input.default) === true)
  }
  const text = await askText(
    message,
    saved === undefined ? '' : inputText(input, saved),
    {
      validate: (answer) => {
        const parsed = parseVariableText(input, answer)
        return 'error' in parsed ? parsed.error : undefined
      },
    },
  )
  const parsed = parseVariableText(input, text)
  return 'value' in parsed ? parsed.value : text
}

// Without a name, in a terminal: picks some of the variables of your tools,
// the ones you can set
const askNames = async (
  inputs: WantedInput[],
  values: Record<string, unknown>,
) => {
  const settable = inputs.filter(
    (input) => !input.secret && !input.provided && !input.vault,
  )
  if (settable.length === 0) {
    throw new Error('Your tools take no variables you can set.')
  }
  return askMultiSelect(
    'Which variables?',
    settable.map((input) => ({
      value: input.name,
      label: input.name,
      hint:
        input.name in values
          ? valueText(values[input.name])
          : input.required
            ? 'missing'
            : input.roles.join(', '),
    })),
  )
}

// The input of a variable a value can be saved for: one a tool of the
// sources declares, no secret, and not one a role that runs sets or a vault
// gives (that value wins, a saved one would never be used)
const settableInput = (
  name: string,
  all: WantedInput[],
  wanted: WantedInput[],
) => {
  const input = all.find((candidate) => candidate.name === name)
  if (!input) {
    throw new Error(
      `No tool of your sources declares ${name}. \`local-env vars\` lists the variables of your tools.`,
    )
  }
  const used = wanted.find((candidate) => candidate.name === name)
  if (used?.vault) {
    throw new Error(
      `${name} comes from the secrets of its source: local-env reads it from the vault at install.`,
    )
  }
  if (input.secret) {
    throw new Error(
      `${name} is a secret: local-env never saves one. Its source can give it from a vault, in the secrets of its local-env.yml.`,
    )
  }
  if (used?.provided) {
    throw new Error(
      `${used.setBy.join(', ')} ${used.setBy.length === 1 ? 'sets' : 'set'} ${name}: its value wins.`,
    )
  }
  return { input, used: used !== undefined }
}

const setCommand = new Command('set')
  .description(
    'Save the value of a variable of your tools: without a value, asks for it; without a name, asks which ones',
  )
  .argument('[name]', 'The variable, as its role declares it')
  .argument('[value]', 'A list as "a, b", a dict as JSON')
  .action(async (given: string | undefined, text: string | undefined) => {
    try {
      const catalog = listCatalog()
      const values = readVariables(TOOLS_DIR)
      const all = readAllInputs(catalog)
      const wanted = readWantedInputs(catalog, currentRoots(catalog))
      if (given === undefined && !canAsk()) {
        throw new Error(
          'Name the variable: `local-env vars set <name> <value>`. `local-env vars` lists them.',
        )
      }

      // The values to save, by name: all asked first, then saved at once
      const changes: Record<string, unknown> = {}
      const unused: string[] = []
      for (const name of given ? [given] : await askNames(wanted, values)) {
        const { input, used } = settableInput(name, all, wanted)
        if (!used) unused.push(name)
        if (text !== undefined) {
          const parsed = parseVariableText(input, text)
          if ('error' in parsed) throw new Error(`${name}: ${parsed.error}`)
          changes[name] = parsed.value
        } else if (canAsk()) {
          changes[name] = await askValue(input, values[name])
        } else {
          throw new Error(
            `Give a value for ${name}, ${accepted(input)}: \`local-env vars set ${name} <value>\`.`,
          )
        }
      }

      mkdirSync(TOOLS_DIR, { recursive: true })
      writeVariables(TOOLS_DIR, { ...readVariables(TOOLS_DIR), ...changes })
      for (const [name, value] of Object.entries(changes)) {
        logger.success(`${name} set to ${valueText(value)}`)
      }
      // What happens next, where it is seen
      const one = Object.keys(changes).length === 1
      // Last, in green, closing the frame as install's summary does. Its
      // first line is its title.
      closeFrameWithCallout(
        'success',
        [
          one ? 'Variable set' : 'Variables set',
          unused.length === 0
            ? `The next \`local-env install\` uses ${one ? 'it' : 'them'}.`
            : `No tool you install uses ${unused.join(', ')} yet: saved for later.`,
        ].join('\n'),
        { tinted: true },
      )
    } catch (error) {
      logger.error('Could not set the variable:', error)
      process.exit(1)
    }
  })

const unsetCommand = new Command('unset')
  .description('Remove the value of a variable: its role uses its default')
  .argument('<name>', 'The variable')
  .action((name: string) => {
    const values = readVariables(TOOLS_DIR)
    if (!(name in values)) {
      logger.info(`${name} has no value saved.`)
      return
    }
    const { [name]: _, ...others } = values
    writeVariables(TOOLS_DIR, others)
    logger.success(`${name} removed`)
  })

export const varsCommand = new Command('vars')
  .alias('variables')
  .description('List or change the variables of your tools')
  // `local-env vars` lists them
  .addCommand(listCommand, { isDefault: true })
  .addCommand(setCommand)
  .addCommand(unsetCommand)
