# Docker templates

A Docker template is a stack that people deploy from the dashboard's Docker page
or with `local-env deploy`: `docker/templates.json` lists them, and each one has
its folder in `docker/`. [Create a source](1-source-repo.md) first.

## templates.json

A standard Portainer template list, version 3. The dashboard shows each stack
entry: its `title`, `description`, `logo` and `categories`. Portainer and
Dockhand can read the list without local-env too, from a public GitHub repo.

```json
{
  "version": "3",
  "templates": [
    {
      "type": 3,
      "title": "Mailpit",
      "description": "Catches the emails your apps send.",
      "categories": ["mail"],
      "platform": "linux",
      "repository": {
        "url": "https://github.com/acme/my-templates",
        "stackfile": "docker/mailpit/compose.yaml"
      }
    }
  ]
}
```

There are two kinds of templates:

| `type` | What it is                                    | Use it for                        |
| ------ | --------------------------------------------- | --------------------------------- |
| `3`    | A stack: `stackfile` points to a compose file | Most templates: anything below    |
| `1`    | A single container, described in the JSON     | A one-container app, nothing else |

Prefer `type: 3`. A compose file can hold several services (an app and its
database), build images and use every feature below, and you can test it with
`docker compose up`. Dockhand turns a `type: 1` template into a compose file
when it deploys it, without a `name:`, so its stacks are linked by image (see
[Updates](#how-updates-reach-users)) and can't build.

`id` isn't needed: Portainer numbers the templates itself, Dockhand and
local-env ignore it.

## compose.yaml

```yaml
name: mailpit # unique across all templates
services:
  mailpit:
    image: axllent/mailpit:latest # a moving tag
    restart: unless-stopped
    environment:
      VIRTUAL_HOST: mail # served at https://mail.dev.test
      VIRTUAL_PORT: 8025 # the port of the web UI
```

- **`name:`** at the top, unique across every template of every source.
  local-env links each deployed stack to its template by this name, and that
  link is how your later changes reach it. Don't rename it once people use the
  template.
- **`VIRTUAL_HOST`** gives the service an HTTPS address: `mail` becomes
  `https://mail.dev.test` (the domain is the user's setting). A full hostname is
  used as is.
- **`VIRTUAL_PORT`** is the port the app listens on, inside the container. It
  can be left out when the image exposes a single port, or the app listens
  on 80.
- **No `ports:`** for web apps: the route is enough, and published ports would
  clash between templates. When something must be reachable from the Mac
  directly, like SMTP, publish it on `127.0.0.1` only: `127.0.0.1:1025:1025`.
- **No `networks:`.** local-env attaches every container with a `VIRTUAL_HOST`
  to its proxy network.
- **Moving image tags** (`latest`, `16`, `2-slim`): Dockhand's auto-update then
  pulls new versions. A pinned tag (`16.4`) never updates.

### Building an image

A service can build from the template folder with a relative `build:`:

```yaml
services:
  site:
    build: ./site # docker/hello/site/Dockerfile
    image: local-env/hello # optional: names the built image
```

Dockhand builds it when the template is deployed, and `sources sync` rebuilds
the stack when the folder changes. Dockhand only gets the compose file, so
local-env serves the folder to Docker's builder. Put config files in the image
(`COPY`) rather than mounting them. Portainer can't build these templates.

### Files from the Mac

Start a path with `${HOST_HOME}` to mount a file or folder from the user's Mac:

```yaml
volumes:
  - ${HOST_HOME}/dev/app.ini:/etc/app.ini:ro
```

local-env replaces it with the home folder. `~` doesn't work: compose runs
inside Dockhand, where `~` is Dockhand's own home.

### Calling other apps

Containers with a route can call each other's addresses
(`https://api.dev.test`). To trust the local certificate, mount the local CA and
point `SSL_CERT_FILE` (`NODE_EXTRA_CA_CERTS` for Node) at it:

```yaml
environment:
  SSL_CERT_FILE: /etc/local-env/ca.pem
volumes:
  - type: bind
    source: ${HOST_HOME}/Library/Application Support/mkcert/rootCA.pem
    target: /etc/local-env/ca.pem
    read_only: true
```

Containers with a route can also reach each other by container name, on the
app's own port: `mailpit:1025`.

### Private images

When a template uses private images, add a login of type `registry` for each
registry to the `logins` of the manifest:

```yaml
# local-env.yml
name: acme-platform
logins:
  ghcr:
    type: registry
    host: ghcr.io
    usernameHelp: your GitHub username
    tokenHelp:
      'a classic token with read:packages only:
      https://github.com/settings/tokens/new?scopes=read:packages&description=local-env'
```

The key (`ghcr`) is the name of the login: lowercase letters, digits and `-`.
`host` is the registry host. `usernameHelp` and `tokenHelp` are optional:
local-env shows them when it asks for the username and the token. Write what the
user must give, and where to get it. local-env has no help of its own.

When a user adds the source, local-env asks for a username and a token for each
host that has no login yet. `start`, `update` and `sources sync` ask again,
until the user logs in or selects "Don't ask again". Without a terminal,
local-env only shows the command to run. Dockhand tests the login, then keeps
it, and logs in to the registry before each deploy. To log in, change the token
or remove it:

```sh
local-env login                       # every login that does not work, in every source
local-env login acme-platform/ghcr    # this one, again
echo "$TOKEN" | local-env login acme-platform/ghcr -u octocat --password-stdin
local-env logout acme-platform/ghcr
```

`local-env login` asks for each login that is missing, and leaves the others. A
named login (`<source>/<login>`) is asked again. A registry login is for a host,
not for a source: sources that use the same host use the same login.

`local-env sources list` shows whether each source that needs a login has one.
`local-env doctor` tests each login against its registry.

For images on ghcr.io, each user creates a classic personal access token with
the `read:packages` scope only, one time. Do not use the token of
`gh auth token`: it can also push code and change workflows. One token gives
access to the packages of all the organizations of the user.

Docker keeps one login for each host. Thus, sources that need two different
accounts on the same host cannot both work.

#### AWS ECR

AWS ECR takes no fixed login: the username is `AWS` and the password is a token
of `aws ecr get-login-password`, which expires after 12 hours. For an ECR host,
add `login` to the registry login. It names an
[aws login](../3-how-it-works/logins.md) of the manifest, and local-env gets the
tokens with its session:

```yaml
# local-env.yml
logins:
  acme-dev:
    type: aws
    profile: acme-dev # or sso: { startUrl, region, accountId, roleName }
  ecr:
    type: registry
    host: 123456789012.dkr.ecr.us-east-1.amazonaws.com
    login: acme-dev
```

local-env asks for no username or token. On `start`, `update`, `sources sync`,
`deploy` and `install`, it gets a new token when the one in Dockhand has lived
half of its 12 hours, and saves it in Dockhand as the user `AWS`. The token is
for the region of the host. When the aws login is logged out, local-env offers
to log in; without a terminal, it only shows the command to run.
`local-env login` does the same, and `local-env login <source>/ecr` gets a new
token at once, even when the one in Dockhand is fresh.

Without `login`, an ECR registry is a login the user types: local-env asks only
for the token, as the username is always `AWS`. Say how to get one in
`tokenHelp` (`run: aws ecr get-login-password --region us-east-1`). The user
types a new token every 12 hours.

`login` takes the name of a login of the same source, or `<source>/<name>` for a
login of another source, without `usernameHelp` or `tokenHelp`. Today only an
`aws` login gets registry tokens, for ECR hosts. Registries of other clouds
whose tokens expire (Azure ACR, Google Artifact Registry) would each need a
login type of their own.

Dockhand checks for new images in the background, between commands. 12 hours
after the last token, it skips the ECR images, until the next local-env command
gets a new token: running apps are not affected.

### Secrets

A template gets secrets from your company's vault, as the tools do: the
`secrets` of the manifest say where each one is, by the name of the variable it
fills, and the compose file uses it in the list form
(`- MP_SMTP_AUTH=user:${SMTP_PASSWORD:?the SMTP password}`). local-env reads
them when it deploys the stack and saves them in Dockhand as secret variables.
See [Secrets](5-secrets.md#in-a-docker-template).

### What a deploy asks for

A variable without a default, `${NAME:?help}` or `${NAME?help}`, is asked for
when the template deploys, with the text after `?` as help, unless it comes from
the vault. A name with `TOKEN`, `SECRET`, `PASSWORD`, `PASSWD` or `KEY` is typed
masked and kept by Dockhand as a secret. Give everything else a default
(`${TZ:-UTC}`): the user changes it in Dockhand if needed. The dashboard card
lists the variables a deploy asks for.

## How updates reach users

When you commit a change to a template, users get it with
`local-env sources sync` (or `local-env update`, which asks first):

1. local-env finds the stacks deployed from the template: the same `name:`, or,
   for stacks without one (`type: 1`), the same image, after asking the user
   once.
2. It merges your change into each stack, keeping the user's own edits: an added
   variable, a removed port, a route they set.
3. It shows the diff and asks before redeploying. The user can apply it, skip
   this version (asked again at your next change), or unlink the stack (never
   synced again).

`local-env sources links` lists every stack and its template.

To keep updates smooth:

- **Keep the `name:`**: a renamed template is a new template, and existing
  stacks are no longer linked to it.
- **Change little at a time**: a merge keeps the user's edits, except where you
  changed the same lines. Then the user has to choose.
- **Add rather than restructure**: a new variable merges cleanly, a moved
  service block conflicts with every edit inside it.

## Checking templates

Before committing, check that every compose file is valid:

```sh
docker compose -f docker/mailpit/compose.yaml config -q
```

Also check that every `stackfile` of `templates.json` exists and that every
`name:` is unique across your templates.

::: info Work in progress
A GitHub template repo for sources is planned: a new source will start from it,
with these checks in a git hook.
:::

## Other catalogs

Existing Portainer catalogs (Lissy93, portainer/templates, a vendor's list) are
added in Dockhand rather than as sources: **Settings → Templates → Add source**,
with the raw URL of their `templates.json`. Dockhand reads any layout, and
local-env leaves these sources alone. Their stacks get Dockhand's image updates,
not template updates. local-env removes the catalogs Dockhand ships with, once,
and hides Dockhand's Templates page, where your sources' templates are not
listed: users who want other catalogs show it again in Dockhand's sidebar
settings ([Deploy apps](../1-user-guide/3-apps.md#other-catalogs)).

## A complete example

```yaml
# docker/mailpit/compose.yaml
name: mailpit # the link to deployed stacks: never rename
services:
  mailpit:
    image: axllent/mailpit:latest # moving tag: auto-update pulls new versions
    restart: unless-stopped
    ports:
      # SMTP for apps on the Mac, on 127.0.0.1 only. Containers with a route
      # use mailpit:1025.
      - 127.0.0.1:1025:1025
    labels:
      dockhand.tags: 'dev,mail' # filters in Dockhand's stack list
    environment:
      VIRTUAL_HOST: mail # the web UI at https://mail.dev.test
      VIRTUAL_PORT: 8025 # the image exposes 3 ports: say which one
      MP_MAX_MESSAGES: 5000
      MP_SMTP_AUTH_ACCEPT_ANY: 1
      MP_SMTP_AUTH_ALLOW_INSECURE: 1
```

And its entry in `docker/templates.json`:

```json
{
  "type": 3,
  "title": "Mailpit",
  "description": "Catches the emails your apps send and shows them at https://mail.dev.test.",
  "categories": ["mail"],
  "platform": "linux",
  "repository": {
    "url": "https://github.com/acme/my-templates",
    "stackfile": "docker/mailpit/compose.yaml"
  }
}
```
