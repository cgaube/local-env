# Repository Guidelines

## Project Structure

One package: the root `package.json` holds every dependency and script. `apps/`
holds what we build:

- `apps/cli/` is the CLI and its tests. `src/` and `tests/` below are in it.
- `apps/web/` is the dashboard's web app: Vite, React, TanStack Router and
  shadcn (`components.json`, at the root: base-ui, nova, lucide). It is never
  released on its own: `bun run compile` builds it into
  `services/dashboard/public/` (gitignored), which the CLI ships.
- The root holds the core stack the CLI ships, `compose.yaml` and `services/`
  (the Docker images), and the shared tooling: oxlint, oxfmt, lefthook, mise,
  changesets, `bunfig.toml` and `tsconfig.base.json`, which the `tsconfig.json`
  of each folder extends.
- Imports that leave their folder use the aliases of `tsconfig.base.json`
  (`paths`), which Bun, its bundler and tsc all read: `#services/*`
  (`services/`), `#cli/*` (`apps/cli/src`), `#ui/*` (`apps/web/src`). Imports
  within `apps/cli` or `apps/web` stay relative.

- `src/main.ts` is the CLI entrypoint (commander).
- `src/commands/*.ts` implements commands: `setup`, `start`, `stop`, `status`,
  `update`, `sources` (add, list, remove, sync, links), `proxy routes`,
  `doctor`. `update` refreshes the core stack and the sources, then lists the
  stacks whose template changed and offers to run the `sources sync` flow.
  `sources sync` pulls the sources first (`--no-pull` to skip): it is the
  everyday command after a template change, `update` refreshes everything.
- `~/.local-env` (or `$LOCAL_ENV_HOME`) is the home folder: `HOME_DIR` in
  `src/core/paths.ts`. Before each command, `src/core/home.ts` writes the
  shipped files (`compose.yaml`, `services/`) there. The
  `src/core/shipped-files.ts` macro embeds them at build time. Runtime state
  (`config.json`, `services/proxy/certs/`, `volumes/`) lives only in the home
  folder. `src/core/config.ts` reads and writes `config.json` (the domain); the
  CLI passes it to compose as `LOCAL_ENV_DOMAIN`.
- When `LOCAL_ENV_HOME` points at a checkout, its files are used in place:
  `LOCAL_ENV_HOME=. bun run local-env start` runs your working tree.
- `src/core/settings/` defines each `config.json` setting once (`parse`, `ask`,
  `apply`). `local-env setup` asks for all of them and applies them;
  `local-env config set` applies one. `apply` must be idempotent.
- `src/core/certificate.ts` checks the mkcert certificate (missing, expired,
  expiring within 30 days, wrong domain, other CA) and renews it. `start` and
  `update` call it. `src/core/dns.ts` sets up dnsmasq and `/etc/resolver`, and
  skips sudo when they are already correct.
- `src/utils/` holds shared helpers: logger, exec, brew, dnsmasq, prompts.
- `compose.yaml` defines the core stack: `nginx-proxy`, `dockhand`,
  `catalog-server`, `proxy-connector`, `dashboard`. The CLI always passes
  `-f <home>/compose.yaml`.
- `services/proxy/` builds the nginx proxy (plain `nginx:alpine`). It includes
  the routes that `proxy-connector` generates into `volumes/proxy/routes.conf`.
  Certificates are generated into `services/proxy/certs/` in the home folder by
  `local-env setup`.
- `services/catalog-server/server.ts` serves the `docker/` folder of every
  source to Dockhand.
- `services/dashboard/` serves the dashboard at `https://local-env.dev.test`:
  `server.ts` serves the app built from `apps/web` (`public/`, with the app's
  routes falling back to `index.html`) and streams its data on `/api/events`:
  `volumes/proxy/routes.json` (like `local-env proxy routes`), the core services
  and the sources' content counts. A core service with a `local-env.app` label
  gets a card on the overview and a link in the sidebar; `local-env.app.content`
  (`docker`, `ansible`) adds the count of that folder in the sources.
- In `apps/web/src`, `components/ui/` holds the shadcn components, as the CLI
  adds them (`bunx --bun shadcn@latest add <name>`, from the root: it needs a
  `package.json` beside `components.json`). Everything else is in
  `features/<feature>/`: one folder per component with an `index.ts` that
  re-exports it, and the feature's logic beside them
  (`features/routes/routes.ts`). `lib/` is for helpers shared by features.
  `features/layout/navigation.ts` lists the sidebar; `router.tsx` its routes.
- `services/proxy-connector/connector.ts` turns running containers into routes:
  it attaches each container with a `VIRTUAL_HOST` to the proxy network, adds
  the domain to short hosts, writes `routes.conf` and `routes.json`, and reloads
  nginx.
- `src/sources/` clones, pulls and removes sources: git repos (URL or local
  path) cloned into `volumes/sources/<name>` in the home folder.
- `src/providers/<name>/` installs one kind of source content through its app:
  `docker` (Dockhand, reads `docker/`; `steps/` are idempotent provisioning
  steps run on every `start`). Each provider implements `Provider` from
  `src/providers/types.ts` (`provision`, `update`) and is listed in
  `src/providers/index.ts`. `ansible` (Semaphore, reads `ansible/`) comes next.
- `volumes/` in the home folder holds runtime data: the Dockhand database and
  the sources.

## Sources

- `docs/templates.md` is the guide for template authors. Update it with any
  change to how templates are written, linked or updated.
- The CLI ships no templates. Sources hold them: `docker/templates.json` is a
  Portainer template list whose stack entries point to
  `docker/<folder>/compose.yaml`; `ansible/<name>/` will hold roles.
  `catalog-server` serves the list with those entries pointed at itself.
- Templates are plain Portainer templates: nothing local-env specific. A
  deployed stack is linked to the template with the same top-level compose
  `name:`, so templates that should get updates need a unique `name:`. Stacks
  without a matching name (container templates, `"type": 1`, whose compose file
  Dockhand generates) are matched by image: `sources sync` asks once and records
  the answer, or "never ask again". `update` doesn't ask, so stacks made by hand
  don't come up on every update. When a template changes, the user can apply it,
  skip that version (`skip` in the link: asked again when the template changes
  again) or unlink the stack (`{ "ignored": true }`, which wins over a matching
  `name:`). `sources links --forget <stack>` undoes both. The CLI generates
  those compose files with Dockhand's own API (`/api/templates/compose`). The
  deployed version of each stack is recorded in `volumes/template-links.json`.
  `catalog-server` saves every compose version it serves in
  `volumes/template-snapshots/`; `update` and `sources sync` use the deployed
  version as the base of a three-way merge, so users' own edits are kept
  (`src/providers/docker/template-link.ts`, `template-sync.ts`).
- Set `VIRTUAL_HOST: <name>` (and `VIRTUAL_PORT` if the app doesn't listen on 80
  and its image exposes more than one port: a single exposed port is used by
  default). A short name gets the configured domain: `mail` is served at
  `https://mail.dev.test`. Templates from elsewhere work unchanged, and the
  values can be edited in Dockhand.
- Templates declare no network. `services/proxy-connector` attaches every
  container with a `VIRTUAL_HOST` to the `local-env` network, so nginx can route
  to it. Only the container name is registered there, so service names like `db`
  don't clash between stacks.
- Use moving image tags (`latest`, a major version) so Dockhand auto-update can
  pull new images.
- A relative `build:` in a template builds when Dockhand deploys it.
  `catalog-server` rewrites it to a git URL on `127.0.0.1:17080`, which Docker's
  builder reaches as `host.docker.internal`, and serves a single-commit copy of
  each source from `volumes/build-contexts/` (the clones are shallow). The CLI
  applies the same rewrite to compare templates with stacks
  (`services/catalog-server/template-compose.ts`). `update` redeploys with a
  build the stacks whose build folders changed
  (`src/providers/docker/stack-builds.ts`).
- Routed containers also join `local-env-hosts`, where `proxy-connector` gives
  nginx every routed host as an alias: containers can call
  `https://<host>.<domain>`, which otherwise resolves to themselves. They trust
  the certificate once the mkcert CA is mounted (`SSL_CERT_FILE`).
- `${HOST_HOME}` in a template is replaced with the Mac home folder in the same
  pass (`catalog-server` gets it as `HOST_HOME: ${HOME}`). Dockhand gives
  compose only each stack's variables, and `~` is Dockhand's own home there.

## Build, Test, and Development Commands

- This repository uses Bun, not npm, pnpm or yarn. `mise.toml` pins the Bun and
  Node versions (Node runs the changesets CLI); `mise install` sets them up, and
  CI uses the same file through `jdx/mise-action`.
- `mise install` also installs lefthook and the git hooks (`lefthook.yml`).
  Before a commit, the hooks fix the staged files with oxlint and oxfmt; before
  a push, they run `bun run check`.
- `bun install` installs the dependencies and builds the `./local-env` binary.
  Every script runs from the root. `bun run local-env <command>` runs the CLI
  from source, in the current directory.
- `bun run compile` builds `./local-env`. The binary is what the repo produces
  and it embeds the core stack (`services/`): `build:web` runs first (`apps/web`
  into `services/dashboard/public/`), then everything typechecks and the CLI
  compiles. `shipped-files.ts` embeds text as is and other files (the fonts) as
  base64. The root `prepare` runs it on `bun install`. It isn't named `build`:
  `bun build` is Bun's own bundler.
- `bun run check` runs typecheck, oxlint and the oxfmt check: the pre-push hook,
  kept fast. The tests run in CI.
- `bun run fmt` formats with oxfmt.
- `bun run dev` serves the dashboard with hot reload. Its `/api` goes to the
  running dashboard (`https://local-env.<domain>`, the domain of `config.json`
  in the home folder, or `LOCAL_ENV_DASHBOARD_URL`), so it shows your live data.
  To see a change in the real dashboard, `bun run compile` then
  `local-env start` (or `bun run local-env start`) rebuilds it.

## Coding Style

- 2-space indentation, LF, UTF-8, final newline (`.editorconfig`).
- oxfmt: single quotes, no semicolons, trailing commas, print width 80.
- ESM with `.js` import extensions. Command files are kebab-case; exported
  commands are camelCase with a `Command` suffix (`startCommand`).
- In `apps/web`, imports name the `.ts`/`.tsx` file, or a component's folder
  (`#ui/features/copy/copy-button`); files are kebab-case and components
  PascalCase. Use shadcn components and their variants, with semantic colors
  (`text-muted-foreground`), before custom markup.

## Testing

`bun run test` runs `test:cli`, then `test:web`. `test:cli` runs every CLI test,
one process per file, then lists the 5 slowest (`tests/run.ts`); `test:cli:unit`
and `test:cli:e2e` run one folder, and `test:cli:coverage` the unit tests. While
working on a change, run the tests of what you change (`bun test <file>`, from
the root, where `bunfig.toml` preloads `tests/setup.ts`), and `bun run test`
before opening a pull request. CI runs them all on every pull request; the
pre-push hook doesn't, to stay fast. `bun test <file>` runs Bun's own runner,
not the `test` script: fine for one file, without the report. `test:web` runs
Vitest (jsdom, React Testing Library, user-event) on `tests/`, which mirrors
`src/`; `tests/support/render-app.tsx` renders the whole app at a path, fed by a
fake event stream. `bun run test:cli:coverage` shows the lines the unit tests
miss: Bun can't measure the CLI processes the e2e tests start, and lists only
the files the tests import, so its total says little.

- `tests/e2e/commands/<command>.test.ts`: every command has a
  `describe('local-env <command>')` block (`sources add`, `config set`…), which
  `tests/e2e/commands.test.ts` enforces. Each test runs the CLI as a child
  process through `createCli()` (`tests/support/run-cli.ts`): a temporary
  `LOCAL_ENV_HOME`, fake binaries, a fake Dockhand and scripted answers.
  `bun run test:cli:bin` compiles `./local-env` and runs the e2e tests against
  it (`LOCAL_ENV_BIN`), which also checks the files it embeds; tests with
  answers skip then (`test.skipIf(COMPILED)`). It needs macOS on Apple Silicon:
  run it before a release.
- `tests/unit/` mirrors `src/` and `services/`, for logic without processes.
  `tests/setup.ts` gives them a temporary `LOCAL_ENV_HOME` first.
- Questions: `cli.run(args, { answers: [{ ask, answer }] })`. A Bun plugin
  (`tests/support/fake-prompts-plugin.ts`) loads `fake-prompts.ts` in place of
  `src/utils/prompt.ts`, so every question must go through that module. An
  unexpected question, or an answer never used, fails the test.
- External binaries are faked (`tests/support/fake-bin.ts`): `cli.bin.on()` sets
  a reply, `cli.bin.calls()` lists the calls. A call without a reply fails. PATH
  holds only the stubs and the real git, so tests never reach the real Docker,
  Homebrew or sudo. A new binary goes in `FAKED_COMMANDS`.
  `tests/support/machine.ts` sets up common states (`machineReady`,
  `dockerStopped`).
- Dockhand is a stateful fake (`tests/support/fake-dockhand.ts`) that the CLI
  reaches through `LOCAL_ENV_DOCKHAND_URL`. Add the routes a test needs there.
- Factories in `tests/support/factories/` build test data: config, certificates
  (`tests/fixtures/certs/`), Docker rows, Dockhand objects, templates, and real
  git repos shaped like sources (`cli.createSource()`).
  `tests/support/stacks.ts` sets up a stack linked to its template.
- Tests use the domain `local-env-e2e.test` and build port 47080: the CLI reads
  `/etc/resolver/<domain>` and checks the port on the real machine.
- Use snapshots for printed output (tables, lists), and explicit `expect`s for
  behavior (calls, files, exit codes).
- e2e `describe` blocks are `describe.concurrent`, as every test has its own
  home, temporary folder, fakes and Dockhand port. Bun can't run snapshots
  concurrently: keep tests with snapshots in a plain `describe`.
- Test files use the globals `describe`, `test`, `expect` and hooks, without
  importing `bun:test` (`tests/globals.d.ts`), and only APIs Vitest also has
  (`test.skipIf`, not `test.if`), so a move to Vitest stays cheap. Bun APIs stay
  in `tests/support/`.

Validate changes against Docker with `local-env start`, `local-env status` and
`local-env update --dry-run`.

## Commits

Short, imperative, lowercase messages (for example `fix bucket script`).

## Changesets

Versions and `CHANGELOG.md` are managed with changesets
(`.changeset/config.json`). It versions the root package, `local-env`, and tags
its releases `v<version>`.

- A pull request that changes what users get adds a changeset, which CI
  requires: `changeset status` checks the files the binary ships
  (`changedFilePatterns` in `.changeset/config.json`). Add a path there when the
  binary starts shipping it. For a change users would notice:
  `bun run changeset`, pick patch, minor or major, and describe the change for
  users. For a refactor, or a `bun.lock` change that only updates tooling
  (oxlint, Vitest…): `bun run changeset --empty`, which releases nothing. Commit
  the generated `.changeset/*.md` with the change. Other changes (docs, tests,
  CI) need none.
- To release, `bun run version-packages` applies the pending changesets: it
  bumps `package.json` (which `local-env --version` reads) and writes
  `CHANGELOG.md`.
