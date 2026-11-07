import {
  cancel,
  confirm,
  isCancel,
  multiselect,
  password,
  select,
  text,
} from '@clack/prompts'

// The usual exit code of an interrupted command: main.ts closes the frame
// with "Cancelled" only, not "Failed"
export const CANCELLED_EXIT_CODE = 130

// Ctrl-C or Escape on a prompt ends the command
const exitOnCancel = (value: unknown) => {
  if (isCancel(value)) {
    cancel('Cancelled')
    process.exit(CANCELLED_EXIT_CODE)
  }
}

export const askConfirm = async (message: string, initialValue: boolean) => {
  const answer = await confirm({ message, initialValue })
  exitOnCancel(answer)
  return answer === true
}

// validate returns why an answer is refused, and the prompt asks again
export const askText = async (
  message: string,
  initialValue: string,
  { validate }: { validate?: (value: string) => string | undefined } = {},
) => {
  const answer = await text({
    message,
    initialValue,
    validate: validate ? (value) => validate(value ?? '') : undefined,
  })
  exitOnCancel(answer)
  return String(answer)
}

// False without a terminal (CI, a pipe): the command must not wait for an
// answer
export const canAsk = () => process.stdin.isTTY === true

// Masked as it is typed. Required: an empty answer asks again (Ctrl-C still
// stops)
export const askPassword = async (
  message: string,
  { required = false }: { required?: boolean } = {},
) => {
  const answer = await password({
    message,
    validate: required
      ? (value) =>
          value ? undefined : 'Type your password, or press Ctrl-C to stop'
      : undefined,
  })
  exitOnCancel(answer)
  return String(answer)
}

export const askSelect = async (
  message: string,
  options: { value: string; label: string; hint?: string }[],
) => {
  const answer = await select({ message, options })
  exitOnCancel(answer)
  return String(answer)
}

// Several of the options (space ticks one, enter confirms): at least one
export const askMultiSelect = async (
  message: string,
  options: { value: string; label: string; hint?: string }[],
) => {
  const answer = await multiselect({ message, options, required: true })
  exitOnCancel(answer)
  return (answer as string[]).map(String)
}
