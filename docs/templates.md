# Writing templates

A template is an app that people install from Dockhand's Templates page with one
click: a database, a mail catcher, an internal tool. You write templates in a
git repo, a **source**, and everyone who adds that source gets them, then gets
your later changes too.

## A source repo

```
<repo>/
├── docker/
│   ├── templates.json        # the list of templates (Portainer format)
│   ├── mailpit/
│   │   └── compose.yaml      # one folder per stack template
│   └── hello/
│       ├── compose.yaml
│       └── site/Dockerfile   # files a template builds from
└── ansible/<role>/           # Ansible roles (coming soon)
```

Add it once, then sync it after each change:

```sh
local-env sources add https://github.com/acme/my-templates   # a git URL
local-env sources add ~/Projects/my-templates               # or a local repo
# edit, commit, then:
local-env sources sync   # pulls and offers the changes
```

local-env only sees **committed** changes: a source is a clone of the repo, even
when the repo is on your Mac. `sources sync` pulls it, refreshes Dockhand's
Templates page and offers the changes to the stacks deployed from your
templates. `sources sync <source>` does it for one source only.

## templates.json

A standard Portainer template list, version 3. Portainer and Dockhand can read
it without local-env too, from a public GitHub repo.

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

The [local-env-templates](https://github.com/cgaube/local-env-templates) repo
does this in a git hook: before each commit, it formats the files and checks
that every `stackfile` exists, every compose file is valid and every `name:` is
unique (`scripts/check-templates.ts`). Copy it into your source.

## Other catalogs

Existing Portainer catalogs (Lissy93, portainer/templates, a vendor's list) are
added in Dockhand rather than as sources: **Settings → Templates → Add source**,
with the raw URL of their `templates.json`. Dockhand reads any layout, and
local-env leaves these sources alone. Their stacks get Dockhand's image updates,
not template updates. local-env removes the catalogs Dockhand ships with, once:
add back the ones you want this way.

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
