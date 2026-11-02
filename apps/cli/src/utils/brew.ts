import { execa } from 'execa'
import { runTask } from './task.js'

export const hasCommand = async (command: string) => {
  try {
    await execa('which', [command], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

export const getBrewPrefix = async () => {
  try {
    const { stdout } = await execa('brew', ['--prefix'], { stdio: 'pipe' })
    return stdout.trim()
  } catch {
    return null
  }
}

export const ensureBrewInstalled = async (errorMessage?: string) => {
  if (!(await hasCommand('brew'))) {
    throw new Error(errorMessage ?? 'Homebrew is required but was not found.')
  }
}

export const isBrewPackageInstalled = async (pkg: string) => {
  try {
    await execa('brew', ['list', pkg], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

export const ensureBrewTap = async (tap: string) => {
  await runTask(`Tapping ${tap}`, 'brew', ['tap', tap])
}

export const installBrewPackages = async (packages: string[]) => {
  for (const pkg of packages) {
    await runTask(`Installing ${pkg}`, 'brew', ['install', pkg], {
      done: `Installed ${pkg}`,
    })
  }
}
