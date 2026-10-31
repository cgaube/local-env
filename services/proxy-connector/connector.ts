// Turns running containers into proxy routes. For each container with a
// VIRTUAL_HOST it:
// - attaches it to the proxy's network, so templates and stacks need no shared
//   network of their own. The link goes away with the container, so `compose
//   down` can always remove the stack's network. Only the container name is
//   registered there, never compose service names, so a `db` service in two
//   stacks can't clash.
// - adds the domain to short hosts: VIRTUAL_HOST=mail -> mail.<DOMAIN>. Full
//   hostnames are kept as they are.
// - writes routes.conf for nginx (reloaded on change) and routes.json for the
//   dashboard and `local-env proxy routes`.
// - writes services.json, the state of local-env's own services, for the
//   dashboard's Core services section.
// - lets containers reach https://<host>.<DOMAIN> too: inside Docker those
//   names resolve to 127.0.0.1, the container itself. Routed containers also
//   join HOSTS_NETWORK, where the proxy answers to every routed host name.
//   Changing the proxy's names means reconnecting it, which a network of its
//   own keeps away from PROXY_NETWORK and the routing.

const SOCKET = '/var/run/docker.sock'
const PROXY_NETWORK = process.env.PROXY_NETWORK ?? 'local-env'
const HOSTS_NETWORK = process.env.HOSTS_NETWORK ?? 'local-env-hosts'
// The proxy's compose service: its container name is free to change
const PROXY_SERVICE = process.env.PROXY_SERVICE ?? 'nginx-proxy'
const DOMAIN = process.env.DOMAIN ?? 'dev.test'
// The compose project of local-env's own services
const CORE_PROJECT = process.env.CORE_PROJECT ?? 'local-env'
const ROUTES_DIR = '/routes'

type ContainerDetails = {
  Id: string
  Name: string
  Config: {
    Env: string[] | null
    Labels: Record<string, string> | null
    // { "3000/tcp": {} }, from the image's EXPOSE
    ExposedPorts?: Record<string, unknown> | null
  }
  HostConfig: { NetworkMode: string }
  NetworkSettings: { Networks: Record<string, { Aliases?: string[] | null }> }
  State: { Status: string; Health?: { Status: string } }
}

type Route = {
  hosts: string[]
  url: string
  container: string
  stack: string | null
  port: string
  status: string
}

const docker = async (path: string, init?: RequestInit) => {
  const response = await fetch(`http://docker${path}`, {
    ...init,
    unix: SOCKET,
  })
  if (!response.ok) {
    throw new Error(
      `${init?.method ?? 'GET'} ${path}: ${response.status} ${await response.text()}`,
    )
  }
  return response
}

const parseEnv = (env: string[] | null) => {
  const result: Record<string, string> = {}
  for (const entry of env ?? []) {
    const idx = entry.indexOf('=')
    if (idx !== -1) result[entry.slice(0, idx)] = entry.slice(idx + 1)
  }
  return result
}

// host/none/container:<id> modes can't join another network
const canJoinNetwork = (container: ContainerDetails) => {
  const mode = container.HostConfig.NetworkMode
  return !(mode === 'host' || mode === 'none' || mode.startsWith('container:'))
}

const connect = async (
  network: string,
  container: string,
  aliases?: string[],
) => {
  await docker(`/networks/${encodeURIComponent(network)}/connect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      Container: container,
      ...(aliases ? { EndpointConfig: { Aliases: aliases } } : {}),
    }),
  })
}

const attach = async (container: ContainerDetails) => {
  const name = container.Name.slice(1)
  const networks = container.NetworkSettings.Networks
  if (!(PROXY_NETWORK in networks)) {
    await connect(PROXY_NETWORK, container.Id)
    console.log(`attached ${name} to ${PROXY_NETWORK}`)
  }
  // Only for calls between containers: never in the way of the route
  if (!(HOSTS_NETWORK in networks)) {
    try {
      await connect(HOSTS_NETWORK, container.Id)
      console.log(`attached ${name} to ${HOSTS_NETWORK}`)
    } catch (error) {
      console.error(`could not attach ${name} to ${HOSTS_NETWORK}:`, error)
    }
  }
}

const ensureHostsNetwork = async () => {
  const response = await fetch(
    `http://docker/networks/${encodeURIComponent(HOSTS_NETWORK)}`,
    { unix: SOCKET },
  )
  if (response.ok) return
  await docker('/networks/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      Name: HOSTS_NETWORK,
      Driver: 'bridge',
      Labels: { 'local-env': 'hosts' },
    }),
  })
}

// Values end up in the nginx config, so anything unexpected is rejected
const SAFE_HOST = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/
const SAFE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/
const SAFE_PORT = /^\d{1,5}$/

const toHosts = (value: string) =>
  value
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean)
    .map((host) => (host.includes('.') ? host : `${host}.${DOMAIN}`))

// Without VIRTUAL_PORT: the image's only exposed TCP port (Grafana's 3000),
// otherwise 80
const defaultPort = (container: ContainerDetails) => {
  const ports = Object.keys(container.Config.ExposedPorts ?? {})
    .filter((port) => port.endsWith('/tcp'))
    .map((port) => port.slice(0, -'/tcp'.length))
  return ports.length === 1 ? ports[0]! : '80'
}

const toRoute = (container: ContainerDetails): Route | null => {
  const env = parseEnv(container.Config.Env)
  if (!env.VIRTUAL_HOST) return null

  const name = container.Name.replace(/^\//, '')
  const hosts = toHosts(env.VIRTUAL_HOST)
  const port = env.VIRTUAL_PORT ?? defaultPort(container)
  const invalid = hosts.find((host) => !SAFE_HOST.test(host))
  if (invalid || !SAFE_NAME.test(name) || !SAFE_PORT.test(port)) {
    console.error(`skipped ${name}: invalid host, name or port`)
    return null
  }

  const labels = container.Config.Labels ?? {}
  return {
    hosts,
    url: `https://${hosts[0]}`,
    container: name,
    stack: labels['com.docker.compose.project'] ?? null,
    port,
    status: container.State.Health?.Status ?? container.State.Status,
  }
}

const renderConf = (routes: Route[]) =>
  [
    '# Generated by proxy-connector from running containers. Do not edit.',
    `ssl_certificate /etc/nginx/certs/${DOMAIN}.crt;`,
    `ssl_certificate_key /etc/nginx/certs/${DOMAIN}.key;`,
    '',
    'server {',
    '  listen 443 ssl default_server;',
    '  http2 on;',
    '  default_type text/plain;',
    `  return 404 "No container serves this host. See https://local-env.${DOMAIN}\\n";`,
    '}',
    ...routes.flatMap((route) => [
      '',
      'server {',
      '  listen 443 ssl;',
      '  http2 on;',
      `  server_name ${route.hosts.join(' ')};`,
      '  location / {',
      // A variable makes nginx resolve the container at request time, so a
      // stopped container doesn't stop nginx from loading the config
      `    set $upstream http://${route.container}:${route.port};`,
      '    proxy_pass $upstream;',
      '  }',
      '}',
    ]),
    '',
  ].join('\n')

const readFile = async (path: string) => {
  const file = Bun.file(path)
  return (await file.exists()) ? file.text() : ''
}

let currentConf = await readFile(`${ROUTES_DIR}/routes.conf`)
let currentJson = await readFile(`${ROUTES_DIR}/routes.json`)
let currentServices = await readFile(`${ROUTES_DIR}/services.json`)

type CoreContainer = {
  Names: string[]
  State: string
  // "Up 2 hours (healthy)"
  Status: string
  Labels: Record<string, string> | null
  Ports: { IP?: string; PublicPort?: number }[] | null
}

// Every container of the core stack, stopped ones included, with its URL:
// its route, or its only port published on the host (Dockhand)
const writeServices = async (routes: Route[]) => {
  const filters = encodeURIComponent(
    JSON.stringify({ label: [`com.docker.compose.project=${CORE_PROJECT}`] }),
  )
  const containers = (await (
    await docker(`/containers/json?all=1&filters=${filters}`)
  ).json()) as CoreContainer[]

  const services = containers
    .map((container) => {
      const name = container.Names[0]?.replace(/^\//, '') ?? ''
      const ports = [
        ...new Set(
          (container.Ports ?? [])
            .filter((port) => port.PublicPort)
            .map((port) => port.PublicPort!),
        ),
      ].sort((a, b) => a - b)
      const route = routes.find((item) => item.container === name)
      const url =
        route?.url ??
        (ports.length === 1 ? `http://localhost:${ports[0]}` : null)
      const app = container.Labels?.['local-env.app']
      return {
        service: container.Labels?.['com.docker.compose.service'] ?? name,
        description: container.Labels?.['local-env.description'] ?? null,
        // An app gets a card in the dashboard. content is the source folder
        // it uses (docker, ansible), to count what it can install.
        app: app
          ? {
              name: app,
              content: container.Labels?.['local-env.app.content'] ?? null,
            }
          : null,
        container: name,
        url,
        ports,
        // "Up 2 hours (healthy)": the health, when the service checks it
        state:
          /\((healthy|unhealthy|health: starting)\)/
            .exec(container.Status)?.[1]
            ?.replace('health: ', '') ?? container.State,
      }
    })
    .sort((a, b) => a.service.localeCompare(b.service))

  const json = JSON.stringify(services, null, 2)
  if (json === currentServices) return
  await Bun.write(`${ROUTES_DIR}/services.json`, json)
  currentServices = json
}

// The running proxy container, found by its compose service
const findProxy = async () => {
  const filters = encodeURIComponent(
    JSON.stringify({
      label: [
        `com.docker.compose.project=${CORE_PROJECT}`,
        `com.docker.compose.service=${PROXY_SERVICE}`,
      ],
      status: ['running'],
    }),
  )
  const [proxy] = (await (
    await docker(`/containers/json?filters=${filters}`)
  ).json()) as { Id: string }[]
  return proxy ?? null
}

const reloadProxy = async () => {
  try {
    const proxy = await findProxy()
    // Not running yet: it loads routes.conf when it starts
    if (!proxy) return
    await docker(`/containers/${proxy.Id}/kill?signal=HUP`, { method: 'POST' })
    console.log('reloaded nginx')
  } catch (error) {
    console.error('could not reload nginx:', error)
  }
}

// Gives the proxy every routed host name on HOSTS_NETWORK. Aliases are set
// when a container joins a network, so a change reconnects the proxy there.
const syncProxyAliases = async (routes: Route[]) => {
  const proxy = await findProxy()
  if (!proxy) return
  const details = (await (
    await docker(`/containers/${proxy.Id}/json`)
  ).json()) as ContainerDetails
  const wanted = routes.flatMap((route) => route.hosts).sort()
  const endpoint = details.NetworkSettings.Networks[HOSTS_NETWORK]
  const current = (endpoint?.Aliases ?? [])
    .filter((alias) => alias.endsWith(`.${DOMAIN}`))
    .sort()
  if (endpoint && current.join(',') === wanted.join(',')) return

  if (endpoint) {
    await docker(`/networks/${encodeURIComponent(HOSTS_NETWORK)}/disconnect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ Container: proxy.Id, Force: true }),
    })
  }
  await connect(HOSTS_NETWORK, proxy.Id, wanted)
  console.log(`proxy answers on ${HOSTS_NETWORK} for ${wanted.length} hosts`)
}

const sync = async () => {
  const running = (await (await docker('/containers/json')).json()) as {
    Id: string
  }[]
  const containers = await Promise.all(
    running.map(async ({ Id }) => {
      try {
        return (await (
          await docker(`/containers/${Id}/json`)
        ).json()) as ContainerDetails
      } catch {
        // Stopped between the list and the inspect
        return null
      }
    }),
  )

  const routes: Route[] = []
  const taken = new Set<string>()
  for (const container of containers) {
    if (!container || !canJoinNetwork(container)) continue
    const route = toRoute(container)
    if (!route) continue

    // Two containers can't serve the same host; the first one keeps it
    const duplicate = route.hosts.find((host) => taken.has(host))
    if (duplicate) {
      console.error(`skipped ${route.container}: ${duplicate} already routed`)
      continue
    }
    try {
      await attach(container)
    } catch (error) {
      console.error(`could not attach ${route.container}:`, error)
      continue
    }
    route.hosts.forEach((host) => taken.add(host))
    routes.push(route)
  }
  routes.sort((a, b) => a.hosts[0]!.localeCompare(b.hosts[0]!))

  const json = JSON.stringify(routes, null, 2)
  if (json !== currentJson) {
    await Bun.write(`${ROUTES_DIR}/routes.json`, json)
    currentJson = json
  }

  const conf = renderConf(routes)
  if (conf !== currentConf) {
    await Bun.write(`${ROUTES_DIR}/routes.conf`, conf)
    currentConf = conf
    console.log(`routes: ${routes.flatMap((route) => route.hosts).join(', ')}`)
    await reloadProxy()
  }

  try {
    await syncProxyAliases(routes)
  } catch (error) {
    console.error('could not update the proxy host names:', error)
  }

  // Only for the dashboard: never in the way of the routes
  try {
    await writeServices(routes)
  } catch (error) {
    console.error('could not list local-env services:', error)
  }
}

// Events arrive in bursts (a whole stack starting): run one sync at a time,
// and fold every request made meanwhile into a single follow-up sync
let syncing = false
let syncAgain = false
const scheduleSync = async () => {
  if (syncing) {
    syncAgain = true
    return
  }
  syncing = true
  do {
    syncAgain = false
    try {
      await sync()
    } catch (error) {
      console.error('sync failed:', error)
    }
  } while (syncAgain)
  syncing = false
}

const watchEvents = async () => {
  const filters = encodeURIComponent(
    // health_status: a route's status, and the dashboard's, follow health
    JSON.stringify({
      type: ['container'],
      event: ['start', 'die', 'destroy', 'health_status'],
    }),
  )

  while (true) {
    try {
      const response = await docker(`/events?filters=${filters}`)
      if (!response.body) throw new Error('no event stream')
      // Catch containers started or stopped while the stream was down
      scheduleSync()

      for await (const _chunk of response.body) scheduleSync()
    } catch (error) {
      console.error('event stream error, retrying:', error)
    }
    await Bun.sleep(2000)
  }
}

await ensureHostsNetwork()
console.log(`routing containers with VIRTUAL_HOST under .${DOMAIN}`)
await watchEvents()
