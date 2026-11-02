import { cancel, confirm, isCancel, select, text } from '@clack/prompts'

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

export const askText = async (message: string, initialValue: string) => {
  const answer = await text({ message, initialValue })
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
