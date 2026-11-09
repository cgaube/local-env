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
  (the Docker images), the Ansible collection it gives to the roles
  (`ansible/local_env/core`), and the shared tooling: oxlint, oxfmt, lefthook,
  mise, changesets, `bunfig.toml` and `tsconfig.base.json`, which the
  `tsconfig.json` of each folder extends.
- Imports use the aliases of `tsconfig.base.json` (`paths`), which Bun, its
  bundler, Vite and tsc all read, never `./` or `../`: `#services/*`
  (`services/`), `#cli/*` (`apps/cli/src`), `#ui/*` (`apps/web/src`),
  `#cli-tests/*` (`apps/cli/tests`), `#ui-tests/*` (`apps/web/tests`) and
  `#package.json`. Three exceptions stay relative, as they load without the
  aliases: `services/` (each service runs in a container with only its own
  folder), `apps/web/vite.config.ts`, which imports no code of the CLI, and the
  docs site (`docs/.vitepress/`; tests import it as `#docs/*`).

- `src/main.ts` is the CLI entrypoint (commander).
- `src/commands/*.ts` implements commands: `setup`, `start`, `stop`, `status`,
  `update`, `sources` (add, list, remove, sync, links, login, logout),
  `install`, `vars` (list, set, unset), `proxy routes`, `doctor`. `update` first
  upgrades local-env with Homebrew when a newer version is out, then hands over
  to the new version (`src/core/self-update.ts`; a checkout skips it). It
  refreshes the core stack and the sources, then lists the stacks whose template
  changed and offers to run the `sources sync` flow. Last, it upgrades the
  Galaxy collections of the wanted tools (`upgradeGalaxyCollections`), without
  running the playbook. `sources sync` pulls the sources first (`--no-pull` to
  skip): it is the everyday command after a template change, `update` refreshes
  everything.
- `~/.local-env` (or `$LOCAL_ENV_HOME`) is the home folder: `HOME_DIR` in
  `src/core/paths.ts`. Before each command, `src/core/home.ts` writes the
  shipped files (`compose.yaml`, `services/`, `ansible/`) there. The
  `src/core/shipped-files.ts` macro embeds them at build time. Runtime state
  (`config.json`, `services/proxy/certs/`, `volumes/`) lives only in the home
  folder. `src/core/config.ts` reads and writes `config.json` (the domain); the
  CLI passes it to compose as `LOCAL_ENV_DOMAIN`.
- Before each command, `src/core/update-check.ts` says when a newer version can
  be installed (an `info` callout). It reads the version of the Homebrew formula
  (`src/core/homebrew.ts` names the tap), which the release workflow updates
  last, at most once a day, and keeps the answer in `update-check.json` in the
  home folder. A checkout skips it, except in tests, which point
  `LOCAL_ENV_FORMULA_URL` at a fake.
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
  `logger.callout(level, text)` (`callout.ts`: info, success, warn, error) is
  for what must not be missed; `logger.box` for summaries. `local-env ui`,
  hidden from `--help`, shows every piece of the output, ours and clack's, drawn
  by the real code (`src/commands/ui.ts`; `--prompts` runs the questions too).
  Add a new piece there.
- `compose.yaml` defines the core stack: `nginx-proxy`, `dockhand`,
  `catalog-server`, `proxy-connector`, `dashboard`. The CLI always passes
  `-f <home>/compose.yaml`. The core services have `restart: 'no'`: after a
  reboot, `local-env start` brings them back with the dashboard agent.
- The dashboard agent runs `local-env install` and `update` for the dashboard,
  in a pty (`Bun.Terminal`), on the Mac. `local-env start` spawns
  `local-env agent` (hidden) detached (`src/core/agent.ts`); `stop` and `reset`
  end it. It listens on `127.0.0.1:17081` (`LOCAL_ENV_AGENT_PORT`) and wants the
  token it writes to `volumes/agent/token`, which only the dashboard mounts. The
  dashboard pipes `/api/terminal` (WebSocket, its own Origin only) to it; the
  page shows it with xterm.js (`features/terminal/`).
  `services/dashboard/agent-protocol.ts` holds the messages.
  `docs/3-how-it-works/dashboard-terminal.md` explains why.
- `services/proxy/` builds the nginx proxy (plain `nginx:alpine`). It includes
  the routes that `proxy-connector` generates into `volumes/proxy/routes.conf`.
  Certificates are generated into `services/proxy/certs/` in the home folder by
  `local-env setup`.
- `services/catalog-server/server.ts` serves the `docker/` folder of every
  source to Dockhand.
- `services/dashboard/` serves the dashboard at `https://local-env.dev.test`:
  `server.ts` serves the app built from `apps/web` (`public/`, with the app's
  routes falling back to `index.html`) and streams its data on `/api/events`:
  `volumes/proxy/routes.json` (like `local-env proxy routes`), the core
  services, the sources' content counts, the tools and whether the dashboard
  agent runs. A core service with a `local-env.app` label gets a card on the
  overview and a link in the sidebar; `local-env.app.content` (`docker`,
  `ansible`) adds the count of that folder in the sources.
- In `apps/web/src`, `components/ui/` holds the shadcn components, as the CLI
  adds them (`bunx --bun shadcn@latest add <name>`, from the root: it needs a
  `package.json` beside `components.json`). Everything else is in
  `features/<feature>/`: one folder per component with an `index.ts` that
  re-exports it, and the feature's logic beside them
  (`features/routes/routes.ts`). `lib/` is for helpers shared by features.
  `features/layout/navigation.ts` lists the sidebar. The routes are files in
  `routes/` (TanStack Router's file-based routing): a file is a path
  (`routes/tools.tsx` is `/tools`) and only maps it to a page of `features/`.
  The Vite plugin generates `routeTree.gen.ts` from them, on `dev`, `build:web`
  and the tests; it is committed, so typecheck runs without a build, and oxlint
  and oxfmt skip it.
- `services/proxy-connector/connector.ts` turns running containers into routes:
  it attaches each container with a `VIRTUAL_HOST` to the proxy network, adds
  the domain to short hosts, writes `routes.conf` and `routes.json`, and reloads
  nginx.
- `src/sources/` clones, pulls and removes sources: git repos (URL or local
  path) cloned into `volumes/sources/<name>` in the home folder. A source's
  manifest, `local-env.yml` at its root, gives its `name` (unique: the folder,
  the same on every Mac; else the repo's name), its `label` and its `logins`
  (`services/dashboard/source-manifest.ts`, shared with the dashboard;
  `docs/3-how-it-works/source-manifest.md`).
- `src/providers/<name>/` installs one kind of source content through its app:
  `docker` (Dockhand, reads `docker/`; `steps/` are idempotent provisioning
  steps run on every `start`). Each provider implements `Provider` from
  `src/providers/types.ts` (`provision`, `update`) and is listed in
  `src/providers/index.ts`.
- Tools are the Ansible roles of the sources, grouped in collections:
  `ansible/<collection>/galaxy.yml` (namespace, name) and
  `ansible/<collection>/roles/<role>/`, named `<namespace>.<collection>.<role>`
  (a folder without `galaxy.yml` is a plain role, named by its folder). A
  profile is a role tagged `profile` (`galaxy_tags`) whose dependencies are
  other roles or profiles; `local-env.yml` beside `meta/` gives the name to show
  (`label:`) and lists the stack templates a role needs (`stacks:`).
  `services/dashboard/tools.ts`, shared by the dashboard and the CLI, lists them
  (`meta/main.yml`: description, tags, dependencies; a revision hash of the
  files; whether a task uses `become`; the stacks) and reads and writes
  `volumes/tools/`: `picked.json`, the ids of the picked roles
  (`<source>/<full name>`), written by the dashboard (`PUT /api/tools/picked`);
  `profile.json`, written by the dashboard's Profiles page
  (`PUT /api/tools/profile`, `features/profiles/`) and
  `local-env install <profile>` (`--no-save` skips it); `variables.json`, the
  values of the roles' inputs (`meta/argument_specs.yml`, entry point `main`) by
  variable name, written by the dashboard's Variables sheet, one form for the
  whole next install (`features/tools/variables-sheet/`,
  `PATCH /api/tools/variables`, which merges the names that change; a value that
  a profile sets in its dependency `vars:` wins and is not passed), and by
  `local-env install`, which asks for a missing required one and passes the
  wanted roles' values with `--extra-vars @<run folder>/extra-vars.json`
  (`no_log` options are never shown, asked or saved); `installed.json` and
  `stacks.json`, written by `local-env install` (`src/core/tools.ts`), which
  also forgets the tools no longer wanted (it never uninstalls).
  `services/dashboard/role-graph.ts` (no imports: the web app loads it too)
  walks the dependencies, by name in any source: the profile and the picks are
  the roots. `install` writes its own playbook of the roots (by full name, a
  plain role by absolute path) in a folder only the user can read
  (`src/core/run-folder.ts`), links every source's collections there as
  `ansible_collections/<namespace>/<name>`, and runs `ansible-playbook` on the
  Mac, as the user, with `ANSIBLE_COLLECTIONS_PATH` on those links and
  `ANSIBLE_ROLES_PATH` on every source's `ansible/`, for dependencies by name.
  First, it installs the Galaxy collections that the collections of the wanted
  roles need (`galaxy.yml` `dependencies`, without the sources' own) into
  `volumes/tools/collections/` with `ansible-galaxy`
  (`src/core/galaxy-collections.ts`; `update` upgrades them); the dashboard
  shows their roles in a profile's details (`externalRoles`). When a wanted role
  uses `become`, the CLI asks for the password (`askPassword`, required) and
  writes it to Ansible's stdin (`--become-password-file -`): it is never on the
  disk. The folder goes when the run ends, on SIGINT, SIGTERM and SIGHUP too;
  the next run removes the ones of runs that were killed. Ansible prints its
  events as JSON lines (`ansible.posix.jsonl`), which
  `src/core/playbook-output.ts` draws with clack: a group per role, a spinner
  per task, a line per result (`install --verbose` shows Ansible's own output).
  Tests fake them with `tests/support/factories/ansible.ts`. The stacks the
  wanted roles need are planned before the playbook (one confirmation, `--yes`
  to skip it, then registry logins and required variables) and deployed after it
  with Dockhand's `POST /stacks`, linked to their template, once: `stacks.json`
  keeps them from coming back (`src/providers/docker/required-stacks.ts`). The
  dashboard runs nothing on the Mac itself: it asks the dashboard agent.
  `docs/3-how-it-works/tools-and-profiles.md` explains why.
- `volumes/` in the home folder holds runtime data: the Dockhand database, the
  sources, the tools (`volumes/tools/`) and the dashboard agent's files
  (`volumes/agent/`).

## Docs (the site)

- `docs/` is the docs site (https://cgaube.github.io/local-env), in three
  sections: `1-user-guide/` (the guide for users), `2-write-a-source/` (the
  guide for source authors) and `3-how-it-works/` (one file for each feature);
  `index.md` is its home. VitePress builds it (`docs/.vitepress/`: `config.ts`,
  and `sidebar.ts`, which builds the sidebar from the folders), and
  `.github/workflows/docs.yml` publishes it to GitHub Pages on every merge to
  `main`. A page is named by its `# ` title; a number before a dash orders the
  folders and files and is not in the URLs (`1-user-guide/1-install.md` is
  `/user-guide/install`). Links between pages are relative links to the `.md`
  files, numbers included, so they work on GitHub too. `bun run docs:dev` serves
  it with hot reload; `bun run docs:build` (in CI) fails on a link to a page
  that does not exist. Write `{{ }}` only in code: VitePress reads it as Vue
  elsewhere.
- A change that users or source authors see updates their guide in the same pull
  request.

## Feature docs

- `docs/3-how-it-works/` holds one file for each feature: what it does, how it
  works (Mermaid diagrams) and why, then its limits. Its `0-index.md` gives the
  sections and the rules for the diagrams, and lists the files.
- A new feature adds its file in the same pull request as its code. A change to
  how a feature works updates its file, diagrams included. Read the file of a
  feature before you change it: its "Why" section gives the decisions.

## Sources

- `docs/2-write-a-source/` is the guide for source authors. Update it with any
  change to how templates and tools are written, linked or updated.
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
- A source lists the accounts it needs in the `logins` of its manifest, each
  with a `type` (`docs/3-how-it-works/logins.md`). `src/logins/` reads them: a
  `LoginType` per file (`types.ts`), `declared.ts` (the logins of one type in
  every source, grouped by identity), `state.ts` ("don't ask again", in
  `volumes/logins.json`), `index.ts` (the types, and the check of a manifest's
  logins that `sources add` runs). `schemas/source-manifest.json` is the JSON
  schema of the manifest, for editors: a new login type or field goes there too
  (a unit test compares the types). A `registry` login (`host`, optional
  `usernameHelp` and `tokenHelp`, shown in the prompts) is for private images.
  The `registryLoginsStep` (`src/logins/registry.ts`) asks for a login for each
  host that Dockhand has no login for, on every provisioning and `sources sync`
  (only a hint without a terminal), and saves it in Dockhand with its registry
  API. `local-env sources login [name] [--login <login>]` and `logout`
  (`src/commands/sources/login.ts`) manage the logins of a source's registries;
  without a name, they list the sources and the state of their logins. A login
  stays per host in Dockhand, shared by the sources that use that host. The CLI
  only changes the Dockhand registry of a full host (`ghcr.io`, not
  `ghcr.io/team`), and never shows, stores or passes the token on a command
  line.
- `aws` and `vault` logins are for the secrets of roles: local-env keeps no
  secret, the vendor's CLI keeps the session. A `SessionLoginType` describes its
  CLI as data (`types.ts`; `aws.ts`, `vault.ts`), and `session.ts` runs it: the
  status, and the login and logout with the terminal handed over. A role
  declares the secrets it reads in its `local-env.yml`
  (`secrets: { github_token: { login, ref, field } }`; `src/logins/secrets.ts`
  reads these references, which Docker stacks will share), and a task reads one
  with `lookup('local_env.core.secret', 'github_token')`. A role that runs the
  CLI itself names the login (`logins: [acme-dev]` or `[<source>/acme-dev]`).
  Before the sudo password, `install` resolves both (`src/logins/wanted.ts`: own
  source first, then any source; a missing login, a registry, a secret that is
  not valid or one name for two logins stops it), installs the CLI with
  Homebrew, writes `~/.aws/config` (`[profile local-env-<source>-<login>]`, an
  `sso-session` for each start URL; never a section it did not write, which
  `volumes/logins.json` records) and checks the session. Logged out, it offers
  to log in, except without a terminal or from the dashboard: the agent sets
  `LOCAL_ENV_FROM_DASHBOARD=1`. Then it passes, in the extra vars,
  `local_env_secrets` (by role full name, then secret name: the command from the
  type's `secretCommand`, its `env` and the JSON keys to take; never a value)
  and `local_env_logins` (by the name the roles use: `env`, `profile`/`region`
  or `address`/`namespace`). The lookup is `ansible/local_env/core`, a
  collection that the binary ships (`shipped-files.ts`) and every run links
  first (`linkCollections`); it only runs what it is given, and
  `tests/unit/ansible/secret-lookup.test.ts` runs it with the real Ansible
  (skipped without it). `sources list`, `login`, `logout` and `doctor` show and
  manage every type (`listing.ts`).
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
  compiles. `shipped-files.ts` embeds text as is and other files (images, fonts)
  as base64. The root `prepare` runs it on `bun install`. It isn't named
  `build`: `bun build` is Bun's own bundler.
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
  Homebrew or sudo. A new binary goes in `FAKED_COMMANDS`. A rule can `touch` a
  file, and another match only `ifFile` it exists: a call that changes the next
  ones (a login that opens a session). `tests/support/machine.ts` sets up common
  states (`machineReady`, `dockerStopped`).
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
