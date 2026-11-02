import { execa } from 'execa'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'fs'
import { basename, isAbsolute, join, resolve } from 'path'
import { HOME_DIR } from '../core/paths.js'
import { BUILD_CONTEXTS_BRANCH } from '#services/catalog-server/template-compose.js'
import { logger } from '../utils/logger.js'
import { runTask } from '../utils/task.js'

// A source is a git repo of installable content, cloned into
// volumes/sources/<name>. Each provider reads its own folder from it:
// docker/ (templates.json and a folder per stack) for Dockhand, ansible/<name>/
// for roles. The clones are the source of truth, so there is no separate list
// to keep in sync.
export const SOURCES_DIR = resolve(HOME_DIR, 'volumes/sources')
// One single-commit repo per source, served to Docker's builder by
// catalog-server (services/catalog-server/template-compose.ts)
export const BUILD_CONTEXTS_DIR = resolve(HOME_DIR, 'volumes/build-contexts')

export const COMPOSE_FILES = [
  // Docker's order of preference, for a folder with several
  'compose.yaml',
  'compose.yml',
  'docker-compose.yaml',
  'docker-compose.yml',
]

export const isValidSourceName = (name: string) =>
  /^[a-z0-9][a-z0-9-]*$/.test(name)

export const sourceNameFromUrl = (url: string) =>
  basename(url.replace(/\/+$/, ''))
    .replace(/\.git$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')

// A name that tells two repos of the same name apart: the owner (or parent
// folder) and the repo, e.g. acme-local-env-templates
const suggestSourceName = (location: string) => {
  const parts = location
    .replace(/\/+$/, '')
    .replace(/\.git$/, '')
    .split(/[/:]/)
    .filter(Boolean)
  return parts
    .slice(-2)
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
}

// The same repo, whatever the spelling: a trailing .git or slash, ~ in a path
const sameRepo = (a: string, b: string) => {
  const normalize = (location: string) =>
    (isLocalPath(location) ? resolve(expandHome(location)) : location)
      .replace(/\/+$/, '')
      .replace(/\.git$/, '')
      .toLowerCase()
  return normalize(a) === normalize(b)
}

const isLocalPath = (location: string) =>
  isAbsolute(location) || location.startsWith('.') || location.startsWith('~')

const expandHome = (path: string) =>
  path.startsWith('~') ? join(process.env.HOME ?? '', path.slice(1)) : path

export const ensureSourcesDir = () => {
  mkdirSync(SOURCES_DIR, { recursive: true })
}

export const listSources = () => {
  if (!existsSync(SOURCES_DIR)) return []

  return readdirSync(SOURCES_DIR, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        isValidSourceName(entry.name) &&
        existsSync(join(SOURCES_DIR, entry.name, '.git')),
    )
    .map((entry) => entry.name)
    .sort()
}

export const getSourceUrl = async (name: string) => {
  const { stdout } = await execa(
    'git',
    ['-C', join(SOURCES_DIR, name), 'remote', 'get-url', 'origin'],
    { stdio: 'pipe' },
  )
  // Local sources are cloned through file:// to honour --depth
  return stdout.trim().replace(/^file:\/\//, '')
}

// Accepts a git URL or the path of a local git repo. Both are cloned, so a
// local repo's commits arrive with the next `local-env update`.
export const addSource = async (location: string, name: string) => {
  if (!isValidSourceName(name)) {
    throw new Error(
      `Invalid source name "${name}". Use lowercase letters, digits and dashes.`,
    )
  }

  const dir = join(SOURCES_DIR, name)
  if (existsSync(dir)) {
    const existing = await getSourceUrl(name).catch(() => null)
    if (existing && sameRepo(existing, location)) {
      throw new Error(`${location} is already added, as "${name}"`)
    }
    throw new Error(
      `A source is already named "${name}"${existing ? ` (${existing})` : ''}. Add this one under another name: --name ${suggestSourceName(location)}`,
    )
  }

  let origin = location
  if (isLocalPath(location)) {
    const path = resolve(expandHome(location))
    if (!existsSync(join(path, '.git'))) {
      throw new Error(`${path} is not a git repo. Run \`git init\` there.`)
    }
    // git ignores --depth for plain local paths, not for file:// URLs
    origin = `file://${path}`
  }

  ensureSourcesDir()
  // Only the latest commit: sources can hold hundreds of templates and years
  // of history we never read. Uses the developer's own git credentials, so
  // private repos work.
  await runTask(
    `Cloning ${name}`,
    'git',
    ['clone', '--depth', '1', origin, dir],
    { done: `Cloned ${name}` },
  )
  await syncBuildContext(name)
}

export const removeSource = (name: string) => {
  if (!listSources().includes(name)) {
    throw new Error(`Source "${name}" not found in ${SOURCES_DIR}`)
  }
  rmSync(join(SOURCES_DIR, name), { recursive: true, force: true })
  rmSync(join(BUILD_CONTEXTS_DIR, `${name}.git`), {
    recursive: true,
    force: true,
  })
}

const git = async (dir: string, ...args: string[]) =>
  (await execa('git', ['-C', dir, ...args])).stdout.trim()

// Copies the clone's current files into the source's build-context repo as a
// commit without parents: the clone is shallow, and git's plain HTTP protocol,
// which the builder uses, needs every parent of the commit it fetches
export const syncBuildContext = async (name: string) => {
  const clone = join(SOURCES_DIR, name)
  const repo = join(BUILD_CONTEXTS_DIR, `${name}.git`)
  const branch = `refs/heads/${BUILD_CONTEXTS_BRANCH}`
  if (!existsSync(repo)) {
    mkdirSync(BUILD_CONTEXTS_DIR, { recursive: true })
    await execa('git', ['init', '--quiet', '--bare', repo])
    await git(repo, 'symbolic-ref', 'HEAD', branch)
  }

  const tree = await git(clone, 'rev-parse', 'HEAD^{tree}')
  const { stdout: current } = await execa(
    'git',
    ['-C', repo, 'rev-parse', '--verify', '--quiet', `${branch}^{tree}`],
    { reject: false },
  )
  if (current.trim() === tree) return

  const commit = await git(
    clone,
    '-c',
    'user.name=local-env',
    '-c',
    'user.email=local-env@localhost',
    'commit-tree',
    tree,
    '-m',
    'local-env build context',
  )
  await git(clone, 'push', '--quiet', '--force', repo, `${commit}:${branch}`)
  // Drop the previous versions' files, then write the index the plain HTTP
  // protocol reads
  await git(repo, 'gc', '--quiet', '--prune=now')
  await git(repo, 'update-server-info')
}

// Run on every start: also covers clones made before build contexts existed
export const syncBuildContexts = async () => {
  for (const name of listSources()) {
    try {
      await syncBuildContext(name)
    } catch (error) {
      logger.warn(`${name}: could not prepare build contexts: ${error}`)
    }
  }
}

// Clones are read-only snapshots: fetch the latest commit and move to it. A
// depth-1 clone has no history to fast-forward through, and this also follows
// force-pushed branches. A failed fetch (offline, revoked access) keeps the
// current clone.
// Pulls every source, or only `names`
export const pullSources = async (names = listSources()) => {
  logger.group('Sources')
  for (const name of names) {
    const dir = join(SOURCES_DIR, name)
    try {
      await runTask(
        `Pulling ${name}`,
        'git',
        ['-C', dir, 'fetch', '--depth', '1', 'origin', 'HEAD'],
        { done: `${name} up to date` },
      )
      await execa('git', [
        '-C',
        dir,
        'reset',
        '--hard',
        '--quiet',
        'FETCH_HEAD',
      ])
      await syncBuildContext(name)
    } catch {
      logger.warn(`Could not pull ${name}, keeping current copy`)
    }
  }
}

const subfolders = (dir: string) =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .map((entry) => entry.name)
        .sort()
    : []

// The source's Portainer template list. Each stack template points to
// docker/<folder>/<compose file> in the same repo.
export const TEMPLATES_FILE = 'docker/templates.json'

type PortainerTemplate = {
  type?: unknown
  repository?: { stackfile?: unknown }
}

// docker/<folder> of every stack template in docker/templates.json whose
// compose file is in the source. Entries pointing elsewhere are left out.
const listTemplateFolders = (dir: string) => {
  let templates: PortainerTemplate[]
  try {
    const list = JSON.parse(readFileSync(join(dir, TEMPLATES_FILE), 'utf8'))
    templates = Array.isArray(list?.templates) ? list.templates : []
  } catch {
    return []
  }
  const folders = templates.flatMap(({ type, repository }) => {
    const stackfile = repository?.stackfile
    if (type !== 3 || typeof stackfile !== 'string') return []
    const [root, folder, file, ...rest] = stackfile.split('/')
    const local =
      root === 'docker' &&
      folder &&
      !folder.startsWith('.') &&
      file &&
      rest.length === 0 &&
      existsSync(join(dir, stackfile))
    return local ? [folder] : []
  })
  return [...new Set(folders)].sort()
}

// A container template (type 1): Dockhand deploys it as a stack too, with a
// compose file it generates from these fields
export type ContainerTemplate = {
  // The name of its service in that compose file, as Dockhand derives it
  slug: string
  entry: Record<string, unknown>
}

// The container templates of docker/templates.json. Swarm (type 2) and stack
// (type 3) templates are left out.
export const listContainerTemplates = (name: string): ContainerTemplate[] => {
  let templates: Record<string, unknown>[]
  try {
    const list = JSON.parse(
      readFileSync(join(SOURCES_DIR, name, TEMPLATES_FILE), 'utf8'),
    )
    templates = Array.isArray(list?.templates) ? list.templates : []
  } catch {
    return []
  }
  return templates.flatMap((entry) => {
    const title = entry.title ?? entry.name
    if (entry.type === 2 || entry.type === 3 || typeof title !== 'string') {
      return []
    }
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
    return slug ? [{ slug, entry }] : []
  })
}

// What a source offers: the stack templates listed in docker/templates.json
// (their folders), its container templates (their slugs) and ansible/<name>
// roles
export const readSourceContent = (name: string) => {
  const dir = join(SOURCES_DIR, name)
  return {
    docker: listTemplateFolders(dir),
    containers: listContainerTemplates(name).map(({ slug }) => slug),
    ansible: subfolders(join(dir, 'ansible')),
  }
}

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? '' : 's'}`

// "2 docker templates, 1 ansible role"
export const summarizeSourceContent = ({
  docker,
  containers,
  ansible,
}: ReturnType<typeof readSourceContent>) => {
  const templates = docker.length + containers.length
  const parts = [
    templates ? plural(templates, 'docker template') : '',
    ansible.length ? plural(ansible.length, 'ansible role') : '',
  ].filter(Boolean)
  return parts.length ? parts.join(', ') : 'empty'
}
