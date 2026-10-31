import { mkdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { buildTemplate, type TemplateFixture } from './template.js'

// Keeps git away from the user's own config and identity
export const GIT_ENV = {
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'local-env tests',
  GIT_AUTHOR_EMAIL: 'tests@local-env.test',
  GIT_COMMITTER_NAME: 'local-env tests',
  GIT_COMMITTER_EMAIL: 'tests@local-env.test',
}

const git = (dir: string, ...args: string[]) => {
  const result = Bun.spawnSync(['git', '-C', dir, ...args], {
    env: { ...process.env, ...GIT_ENV },
  })
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  }
  return result.stdout.toString().trim()
}

const writeFile = (path: string, content: string) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

export type SourceRepo = {
  dir: string
  // Writes the files and commits them, like a template author pushing
  commit: (files: Record<string, string>, message?: string) => string
}

// A git repo shaped like a source, for `local-env sources add <dir>`. Real
// git: sources are cloned, pulled and served as build contexts.
export const createSourceRepo = (
  dir: string,
  {
    templates = [buildTemplate()],
    containers = [],
    roles = [],
  }: {
    templates?: TemplateFixture[]
    containers?: Record<string, unknown>[]
    roles?: string[]
  } = {},
): SourceRepo => {
  mkdirSync(dir, { recursive: true })
  git(dir, 'init', '--quiet', '--initial-branch', 'main')

  const commit = (files: Record<string, string>, message = 'update') => {
    for (const [path, content] of Object.entries(files)) {
      writeFile(join(dir, path), content)
    }
    git(dir, 'add', '--all')
    git(dir, 'commit', '--quiet', '--message', message)
    return git(dir, 'rev-parse', 'HEAD')
  }

  const files: Record<string, string> = {
    'docker/templates.json': `${JSON.stringify(
      {
        version: '3',
        templates: [...templates.map(({ entry }) => entry), ...containers],
      },
      null,
      2,
    )}\n`,
  }
  for (const { folder, compose } of templates) {
    files[`docker/${folder}/compose.yaml`] = compose
  }
  for (const role of roles) {
    files[`ansible/${role}/tasks/main.yml`] = '- debug: msg=hello\n'
  }
  commit(files, 'initial templates')

  return { dir, commit }
}
