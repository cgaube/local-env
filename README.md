<h1 align="center"><img src=".github/logo.svg" width="96" height="96" alt=""> <br/>local-env</h1>

A local development environment for macOS:

- **HTTPS proxy**: every container with `VIRTUAL_HOST=name` is served at
  `https://name.dev.test` with a trusted local certificate. No network setup is
  needed. The routes are listed at `https://local-env.dev.test`, with help to
  add your own.
- **App catalog**: [Dockhand](https://github.com/Finsys/dockhand) at
  `https://docker.dev.test`, preconfigured with your Docker. It lists the Docker
  templates of every source you add. Click a template to install it; installed
  containers update automatically.
- **Tools**: the Ansible roles of your sources (Git, Node.js…), listed in the
  dashboard at `https://local-env.dev.test/tools`. Pick the ones you want there,
  then `local-env install` installs them on your Mac.
- **Sources**: git repos of Docker templates and Ansible roles. The CLI ships
  none: add your own with `local-env sources add`.

---

## Install

Requires a Mac with Apple Silicon, Homebrew and a Docker engine with Docker
Compose v2 (see
[the requirements](https://cgaube.github.io/local-env/user-guide/install)).

```sh
brew install cgaube/tap/local-env
```

The binary is also attached to every
[release](https://github.com/cgaube/local-env/releases/latest), with its
`SHA256SUMS`.

Then set it up and start it:

```sh
local-env setup    # wildcard DNS (dnsmasq) + certificates (mkcert), asks for sudo,
                   # then offers to start: proxy, Dockhand and the catalog server
local-env sources add ~/Projects/local-env-templates   # or a git URL
```

Open `https://docker.dev.test`, go to Templates and deploy one.

`setup` is safe to re-run: it only redoes what changed or broke. With `--yes`,
it doesn't start local-env: run `local-env start`. local-env keeps its config,
certificates and Dockhand data in `~/.local-env` (or `$LOCAL_ENV_HOME`).

### From source

With [mise](https://mise.jdx.dev), which installs the Bun and Node versions
pinned in `mise.toml`:

```sh
mise install
bun install          # also builds ./local-env
./local-env setup
```

## Documentation

The [docs site](https://cgaube.github.io/local-env) has everything:

- [User guide](https://cgaube.github.io/local-env/user-guide/install): every
  command, tools, logins, troubleshooting
- [Write a source](https://cgaube.github.io/local-env/write-a-source/source-repo):
  Docker templates, tools, profiles, variables and secrets
- [How local-env works](https://cgaube.github.io/local-env/how-it-works/): each
  feature, and why it works that way

The site is built from [`docs/`](docs): change it there, with a pull request.

## License

[MIT](LICENSE)
