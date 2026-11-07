// Loaded in place of src/utils/prompt.ts in the CLI started by e2e tests
// (fake-prompts-plugin.ts). Answers each question from the list the test
// gave `cli.run(args, { answers })`, and logs it. A question nobody expected
// ends the command: a test never hangs on a prompt.
//
// Bun loads this file at src/utils/prompt.ts's path: only package and type
// imports, no relative ones.
import { appendFileSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'

export type FakeAnswer =
  // `ask` is part of the question: a typo in the test fails it
  | { ask: string; answer: boolean | string | string[] }
  // Ctrl-C on that question
  | { ask: string; cancel: true }

export type AskedQuestion = {
  message: string
  // Unexpected: no answer was given for it, or the answer doesn't fit it
  error?: string
}

export const CANCELLED_EXIT_CODE = 130

const dir = process.env.FAKE_PROMPTS_DIR ?? ''
const answersFile = join(dir, 'answers.json')
const logFile = join(dir, 'questions.jsonl')

const asked = () =>
  existsSync(logFile)
    ? readFileSync(logFile, 'utf8').split('\n').filter(Boolean).length
    : 0

const fail = (message: string, error: string): never => {
  const question: AskedQuestion = { message, error }
  appendFileSync(logFile, `${JSON.stringify(question)}\n`)
  console.error(`fake prompt: ${error}\n  question: ${message}`)
  process.exit(1)
}

const next = (message: string) => {
  const answers: FakeAnswer[] = existsSync(answersFile)
    ? JSON.parse(readFileSync(answersFile, 'utf8'))
    : []
  const expected = answers[asked()]
  if (!expected) return fail(message, 'no answer left for this question')
  if (!message.includes(expected.ask)) {
    return fail(message, `expected a question with "${expected.ask}"`)
  }
  const question: AskedQuestion = { message }
  appendFileSync(logFile, `${JSON.stringify(question)}\n`)
  if ('cancel' in expected) {
    console.log('Cancelled')
    process.exit(CANCELLED_EXIT_CODE)
  }
  return expected.answer
}

export const askConfirm = async (message: string, _initialValue: boolean) => {
  const answer = next(message)
  if (typeof answer !== 'boolean') {
    return fail(message, `a yes/no question, answered ${answer}`)
  }
  return answer
}

export const askText = async (
  message: string,
  _initialValue: string,
  { validate }: { validate?: (value: string) => string | undefined } = {},
) => {
  const answer = next(message)
  if (typeof answer !== 'string') {
    return fail(message, `a text question, answered ${answer}`)
  }
  // The real prompt asks again: a test can't get past it
  const refused = validate?.(answer)
  if (refused) return fail(message, `answered ${answer}, refused: ${refused}`)
  return answer
}

// A test can run the CLI as if without a terminal: FAKE_PROMPTS_NO_TTY=1
export const canAsk = () => process.env.FAKE_PROMPTS_NO_TTY !== '1'

export const askPassword = async (
  message: string,
  { required = false }: { required?: boolean } = {},
) => {
  const answer = next(message)
  if (typeof answer !== 'string') {
    return fail(message, `a password question, answered ${answer}`)
  }
  // The real prompt asks again: a test can't get past it with nothing
  if (required && !answer) {
    return fail(message, 'a required password, answered with nothing')
  }
  return answer
}

// The values ticked, in the answer: each one of the options, at least one
export const askMultiSelect = async (
  message: string,
  options: { value: string; label: string; hint?: string }[],
) => {
  const answer = next(message)
  if (
    !Array.isArray(answer) ||
    answer.length === 0 ||
    !answer.every((value) => options.some((option) => option.value === value))
  ) {
    const values = options.map((option) => option.value).join(', ')
    return fail(message, `answered ${answer}, not some of: ${values}`)
  }
  return answer
}

export const askSelect = async (
  message: string,
  options: { value: string; label: string; hint?: string }[],
) => {
  const answer = next(message)
  if (!options.some((option) => option.value === answer)) {
    const values = options.map((option) => option.value).join(', ')
    return fail(message, `answered ${answer}, not one of: ${values}`)
  }
  return String(answer)
}

// The typecheck fails when the real module changes shape
export const fakePrompts = {
  CANCELLED_EXIT_CODE,
  askConfirm,
  askText,
  askPassword,
  askSelect,
  askMultiSelect,
  canAsk,
} satisfies typeof import('#cli/utils/prompt.js')
