# Install local-env

You need a Mac with Apple Silicon, Homebrew, and a Docker engine with Docker
Compose (`docker compose`, version 2).

## The Docker engine

Any Docker engine for macOS works when it gives:

- the `docker` CLI, with Docker Compose v2 (`docker compose`, not the old
  `docker-compose`): local-env runs its services with it;
- the socket `/var/run/docker.sock`, which containers can mount;
- `host.docker.internal`, which reaches the Mac's own `127.0.0.1` from the
  containers and from the image builder. The dashboard reaches the dashboard
  agent there, and templates that build an image get their files there.

## Install and set up

```sh
brew install cgaube/tap/local-env
local-env setup
```

`setup` asks for the settings, then does the work:

- It sets up a wildcard DNS for the domain (`dev.test` by default) with dnsmasq.
  Every name of the domain then points to your Mac.
- It creates a certificate with mkcert, which your Mac trusts.
- It offers to start local-env: the proxy, Dockhand, the dashboard and the
  server of the templates.

It asks for your password (sudo) for the DNS and the certificate. You can run
`setup` again at any time: it only does again what changed or broke. With
`--yes`, it asks nothing and does not start local-env: run `local-env start`.

## Add your team's source

```sh
local-env sources add https://github.com/acme/local-env-templates
```

Your team gives you the URL. A source can also be a git repo on your Mac
(`~/Projects/my-templates`). If the source needs a login (a registry of private
images), local-env asks for it now: see [Log in to your accounts](4-logins.md).

Then:

- Open `https://docker.dev.test`, go to **Templates**, and deploy an app.
- Open `https://local-env.dev.test/profiles`, and pick the profile of your job.
  Then run `local-env install`: see [Install tools](3-tools.md).

## Where local-env keeps its files

In `~/.local-env` (or `$LOCAL_ENV_HOME`): its settings (`config.json`), the
certificates, the clones of the sources and the data of Dockhand. local-env
writes no other files, except the AWS profiles of your logins in
`~/.aws/config`.

## From the source code

For the people who change local-env. With [mise](https://mise.jdx.dev), which
installs the versions of Bun and Node that `mise.toml` pins:

```sh
mise install
bun install          # also builds ./local-env
./local-env setup
```
