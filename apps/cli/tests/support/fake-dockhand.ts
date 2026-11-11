// An in-memory Dockhand API for e2e tests. The CLI reaches it through
// LOCAL_ENV_DOCKHAND_URL. Provisioning and syncs read, then write, so the
// fake keeps state instead of replying with canned responses.
import {
  buildDockhandEnvironment,
  type DockhandContainerUpdate,
  type DockhandRegistryRow,
  type DockhandEnvironment,
  type DockhandStack,
  type DockhandTemplateSource,
} from '#cli-tests/support/factories/dockhand.js'

export type DockhandState = {
  environments: DockhandEnvironment[]
  templateSources: DockhandTemplateSource[]
  exposure: { warn: boolean; dismissed: boolean }
  updateChecks: Record<
    number,
    { enabled: boolean; cron: string; autoUpdate: boolean }
  >
  sidebar: { order: string[]; hidden: string[] }
  stacks: DockhandStack[]
  // What the image check finds, and the containers updated since
  containerUpdates: DockhandContainerUpdate[]
  updatedContainers: string[]
  // Stacks redeployed with a build
  builtStacks: string[]
  // With their password, which the API never returns
  registries: DockhandRegistryRow[]
}

export type DockhandRequest = {
  method: string
  path: string
  query: URLSearchParams
  params: Record<string, string>
  body: unknown
}

type Handler = (request: DockhandRequest, state: DockhandState) => unknown

// The state of a Dockhand that has never been provisioned
const freshState = (): DockhandState => ({
  environments: [],
  templateSources: [],
  exposure: { warn: true, dismissed: false },
  updateChecks: {},
  sidebar: { order: [], hidden: [] },
  stacks: [],
  containerUpdates: [],
  updatedContainers: [],
  builtStacks: [],
  registries: [],
})

// What GET /registries returns: no password, only whether there is one
const publicRegistry = ({ password, ...registry }: DockhandRegistryRow) => ({
  ...registry,
  hasCredentials: Boolean(password),
})

const json = (data: unknown, status = 200) => Response.json(data, { status })

const notFound = (what: string) => json({ error: `${what} not found` }, 404)

const nextId = (items: { id: number }[]) =>
  Math.max(0, ...items.map((item) => item.id)) + 1

const findStack = (state: DockhandState, name = '') =>
  state.stacks.find((stack) => stack.name === name)

// The routes the CLI uses. Add the ones a new test needs here; a single test
// can override any route with `on()`.
const ROUTES: Record<string, Handler> = {
  'GET /environments': (_, state) => state.environments,
  'POST /environments': ({ body }, state) => {
    const environment = buildDockhandEnvironment({
      ...(body as Partial<DockhandEnvironment>),
      id: nextId(state.environments),
    })
    state.environments.push(environment)
    return environment
  },
  'GET /exposure-status': (_, state) => state.exposure,
  'POST /exposure-status': (_, state) => {
    state.exposure.dismissed = true
    return {}
  },
  'GET /environments/:id/update-check': ({ params }, state) => ({
    settings: state.updateChecks[Number(params.id)] ?? {
      enabled: false,
      cron: '0 4 * * *',
      autoUpdate: false,
    },
  }),
  'POST /environments/:id/update-check': ({ params, body }, state) => {
    state.updateChecks[Number(params.id)] =
      body as DockhandState['updateChecks'][number]
    return {}
  },
  'GET /preferences/sidebar': (_, state) => ({ preferences: state.sidebar }),
  'POST /preferences/sidebar': ({ body }, state) => {
    state.sidebar = body as DockhandState['sidebar']
    return { preferences: state.sidebar }
  },

  'GET /templates/sources': (_, state) => state.templateSources,
  'POST /templates/sources': ({ body }, state) => {
    const { name, url } = body as { name: string; url: string }
    const source = {
      id: nextId(state.templateSources),
      name,
      url,
      enabled: true,
      builtin: false,
    }
    state.templateSources.push(source)
    return source
  },
  'PUT /templates/sources': ({ body }, state) => {
    const update = body as Partial<DockhandTemplateSource> & { id: number }
    const source = state.templateSources.find(({ id }) => id === update.id)
    if (source) Object.assign(source, update)
    return source ?? {}
  },
  'DELETE /templates/sources': ({ query }, state) => {
    const id = Number(query.get('id'))
    state.templateSources = state.templateSources.filter(
      (source) => source.id !== id,
    )
    return {}
  },
  // The compose file Dockhand deploys a container template (type 1) with
  'POST /templates/compose': ({ body }) => {
    const { template } = body as { template: { title: string; image: string } }
    const slug = template.title.toLowerCase().replace(/[^a-z0-9-]/g, '-')
    return {
      compose: [
        'services:',
        `  ${slug}:`,
        `    image: ${template.image}`,
        '    restart: unless-stopped',
        '',
      ].join('\n'),
    }
  },

  'GET /stacks': (_, state) =>
    state.stacks.map(({ name, createdAt }) => ({
      name,
      containerDetails: [{ created: createdAt }],
    })),
  // Creates and starts a stack. Like Dockhand, it replaces one of the same
  // name without a word: the CLI must check first.
  'POST /stacks': ({ body }, state) => {
    const {
      name,
      compose,
      envVars = [],
    } = body as {
      name: string
      compose: string
      envVars?: { key: string; value: string; isSecret?: boolean }[]
    }
    state.stacks = state.stacks.filter((stack) => stack.name !== name)
    state.stacks.push({
      name,
      content: compose,
      createdAt: Math.floor(Date.now() / 1000),
      variables: envVars.map(({ key, value, isSecret = false }) => ({
        key,
        value,
        isSecret,
      })),
    })
    return { success: true, started: true }
  },
  'GET /stacks/:name/compose': ({ params }, state) => {
    const stack = findStack(state, params.name)
    return stack ? { content: stack.content } : notFound('stack')
  },
  'PUT /stacks/:name/compose': ({ params, body }, state) => {
    const stack = findStack(state, params.name)
    if (!stack) return notFound('stack')
    stack.content = (body as { content: string }).content
    return { success: true }
  },
  // A secret's value never leaves Dockhand: ***
  'GET /stacks/:name/env': ({ params }, state) => ({
    variables: (findStack(state, params.name)?.variables ?? []).map(
      ({ key, value, isSecret }) => ({
        key,
        value: isSecret ? '***' : value,
        isSecret,
      }),
    ),
    injectedSecretKeys: [],
  }),
  // Replaces the variables. A secret that comes back as *** keeps its value.
  'PUT /stacks/:name/env': ({ params, body }, state) => {
    const stack = findStack(state, params.name)
    if (!stack) return notFound('stack')
    const { variables } = body as {
      variables: { key: string; value: string; isSecret: boolean }[]
    }
    stack.variables = variables.map((variable) => {
      const known = stack.variables.find(({ key }) => key === variable.key)
      return variable.isSecret && variable.value === '***' && known
        ? { ...variable, value: known.value }
        : variable
    })
    return { success: true, count: variables.length }
  },
  // Required variables: ${NAME} without a default
  'POST /stacks/:name/env/validate': ({ body }) => {
    const { compose, variables } = body as {
      compose: string
      variables: string[]
    }
    const required = [...compose.matchAll(/\$\{([A-Z0-9_]+)\}/g)].map(
      ([, name]) => name!,
    )
    return {
      missing: [...new Set(required)].filter(
        (name) => !variables.includes(name),
      ),
    }
  },
  'POST /stacks/:name/deploy': ({ params }, state) => {
    if (!findStack(state, params.name)) return notFound('stack')
    state.builtStacks.push(params.name!)
    return { success: true }
  },

  'GET /registries': (_, state) => state.registries.map(publicRegistry),
  'POST /registries': ({ body }, state) => {
    const registry = {
      ...(body as Omit<DockhandRegistryRow, 'id'>),
      id: nextId(state.registries),
    }
    state.registries.push(registry)
    return publicRegistry(registry)
  },
  'PUT /registries/:id': ({ params, body }, state) => {
    const registry = state.registries.find(({ id }) => id === Number(params.id))
    if (!registry) return notFound('registry')
    Object.assign(registry, body)
    return publicRegistry(registry)
  },
  'DELETE /registries/:id': ({ params }, state) => {
    state.registries = state.registries.filter(
      ({ id }) => id !== Number(params.id),
    )
    return { success: true }
  },
  // Every login works; a test overrides the route to reject one
  'POST /registries/test': ({ body }, state) => {
    const { registryId, username } = body as {
      registryId?: number
      username?: string
    }
    const user =
      state.registries.find(({ id }) => id === registryId)?.username ?? username
    return {
      success: true,
      connectivity: true,
      authenticated: true,
      message: `Connected and authenticated as ${user}`,
    }
  },

  'POST /containers/check-updates': (_, state) => ({
    results: state.containerUpdates,
  }),
  'POST /containers/batch-update': ({ body }, state) => {
    const { containerIds } = body as { containerIds: string[] }
    return {
      results: containerIds.map((id) => {
        const container = state.containerUpdates.find(
          (update) => update.containerId === id,
        )
        const containerName = container?.containerName ?? id
        state.updatedContainers.push(containerName)
        return { containerName, success: true }
      }),
    }
  },
}

// "GET /stacks/:name/compose" -> a matcher returning { name: "…" }
const compile = (route: string) => {
  const [method, pattern = ''] = route.split(' ')
  const names: string[] = []
  const regexp = new RegExp(
    `^${pattern.replace(/:(\w+)/g, (_, name: string) => {
      names.push(name)
      return '([^/]+)'
    })}$`,
  )
  return (request: { method: string; path: string }) => {
    if (request.method !== method) return null
    const match = regexp.exec(request.path)
    if (!match) return null
    return Object.fromEntries(
      names.map((name, index) => [name, decodeURIComponent(match[index + 1]!)]),
    )
  }
}

export const startFakeDockhand = (seed: Partial<DockhandState> = {}) => {
  const state: DockhandState = { ...freshState(), ...seed }
  // Overrides first: they win over the default routes
  const routes: { match: ReturnType<typeof compile>; handler: Handler }[] =
    Object.entries(ROUTES).map(([route, handler]) => ({
      match: compile(route),
      handler,
    }))
  const requests: DockhandRequest[] = []

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: async (incoming) => {
      const url = new URL(incoming.url)
      const path = url.pathname.replace(/^\/api/, '')
      const text = await incoming.text()
      const request = {
        method: incoming.method,
        path,
        query: url.searchParams,
        params: {},
        body: text ? JSON.parse(text) : undefined,
      }
      requests.push(request)

      for (const { match, handler } of routes) {
        const params = match(request)
        if (!params) continue
        const result = handler({ ...request, params }, state)
        return result instanceof Response ? result : json(result)
      }
      return json(
        { error: `fake Dockhand: no route ${request.method} ${path}` },
        404,
      )
    },
  })

  return {
    url: server.url.origin,
    state,
    requests,
    // Replaces a route for this test, e.g. to make it fail:
    // on('PUT /stacks/:name/compose', () => ({ success: false, error: '…' }))
    on(route: string, handler: Handler) {
      routes.unshift({ match: compile(route), handler })
    },
    stop: () => server.stop(true),
  }
}

export type FakeDockhand = ReturnType<typeof startFakeDockhand>
