<h1><img src=".github/logo.svg" width="40" height="40" align="top" alt=""> local-env</h1>

A local development environment for macOS:

- **HTTPS proxy**: every container with `VIRTUAL_HOST=name` is served at
  `https://name.dev.test` with a trusted local certificate. No network setup is
  needed. The routes are listed at `https://local-env.dev.test`, with help to
  add your own.
- **App catalog**: [Dockhand](https://github.com/Finsys/dockhand) at
  `https://docker.dev.test`, preconfigured with your Docker. It lists the Docker
  templates of every source you add. Click a template to install it; installed
  containers update automatically.
- **Sources**: git repos of Docker templates (and, soon, Ansible roles). The CLI
  ships none: add your own with `local-env sources add`.

## Install

Requires a Mac with Apple Silicon, Docker Desktop and Homebrew.

```sh
brew install cgaube/tap/local-env
```

The binary is also attached to every
[release](https://github.com/cgaube/local-env/releases/latest), with its
`SHA256SUMS`.

Then set it up and start it:

```sh
local-env setup    # wildcard DNS (dnsmasq) + certificates (mkcert), asks for sudo
local-env start    # proxy, Dockhand and the catalog server
local-env sources add ~/Projects/local-env-templates   # or a git URL
```

Open `https://docker.dev.test`, go to Templates and deploy one.

`setup` is safe to re-run: it only redoes what changed or broke. local-env keeps
its config, certificates and Dockhand data in `~/.local-env` (or
`$LOCAL_ENV_HOME`).

### From source

With [mise](https://mise.jdx.dev), which installs the Bun and Node versions
pinned in `mise.toml`:

```sh
mise install
bun install          # also builds ./local-env
./local-env setup
```

## Commands

| Command                            | What it does                                       |
| ---------------------------------- | -------------------------------------------------- |
| `setup`                            | Wizard: domain, HTTPS certificate and DNS          |
| `start` / `stop` / `status`        | Manage the core services                           |
| `update`                           | Update core services, sources, stacks and images   |
| `sources add <repo>`               | Clone a source from a git URL or a local git repo  |
| `sources list` / `remove`          | Manage sources                                     |
| `sources sync [source]`            | Pull sources, then sync installed stacks with them |
| `sources links`                    | List installed stacks and the template of each     |
| `proxy routes`                     | List the hosts the proxy serves                    |
| `config get` / `set <key> <value>` | Read or change a setting, and apply it             |
| `doctor`                           | Check DNS, certificates and the proxy              |
| `reset`                            | Remove everything local-env created                |

## Sources

A source is a git repo of templates: a `docker/templates.json` list (Portainer
format) and a folder with a `compose.yaml` for each stack.

```
<repo>/
├── docker/
│   ├── templates.json            # Portainer template list (version 3)
│   └── mailpit/compose.yaml      # one folder per stack
└── ansible/<role>/               # coming soon
```

Add one with `local-env sources add <repo>`. After you commit a change to it,
`local-env sources sync` pulls it and offers the change to the stacks deployed
from its templates, keeping your own edits.

To write templates, see [Writing templates](docs/templates.md): the template
list, routes, building images, files from your Mac, and how updates reach users.

## License

[MIT](LICENSE)
