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
│   ├── registries.json       # optional: registries of private images
│   ├── mailpit/
│   │   └── compose.yaml      # one folder per stack template
│   └── hello/
│       ├── compose.yaml
│       └── site/Dockerfile   # files a template builds from
└── ansible/
    └── dev_tools/            # an Ansible collection (see Tools)
        ├── galaxy.yml        # its namespace and name: acme.dev_tools
        └── roles/
            └── git/          # one Ansible role per tool
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

### Private images

When a template uses private images, list their registries in
`docker/registries.json`:

```json
[
  {
    "host": "ghcr.io",
    "usernameHelp": "your GitHub username",
    "tokenHelp": "a classic token with read:packages only: https://github.com/settings/tokens/new?scopes=read:packages&description=local-env"
  }
]
```

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
local-env sources login       # the sources that need a login, and their login
local-env sources login acme  # asks for each registry of the source
echo "$TOKEN" | local-env sources login acme --registry ghcr.io -u octocat --password-stdin
local-env sources logout acme
```

`sources login` asks for each registry of the source that has no login. For a
registry that has a login, it asks first if the user wants to log in again.
`--registry` selects one registry of the source. A login is for a host, not for
a source: sources that use the same host use the same login.

`local-env sources list` shows whether each source that needs a login has one.
`local-env doctor` tests each login against its registry.

For images on ghcr.io, each user creates a classic personal access token with
the `read:packages` scope only, one time. Do not use the token of
`gh auth token`: it can also push code and change workflows. One token gives
access to the packages of all the organizations of the user.

Docker keeps one login for each host. Thus, sources that need two different
accounts on the same host cannot both work.

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

## Tools

A tool is something installed on the Mac itself, not in Docker: Git, Node.js, a
CLI. Each tool is a plain Ansible role, and a tool in the dashboard's catalog
(`https://local-env.dev.test/tools`). People pick the ones they want there, then
run `local-env install`, which runs the picked roles on their Mac with
`ansible-playbook` (`connection: local`, as them).

Group the roles in Ansible collections: one folder of `ansible/` per collection,
with a `galaxy.yml` and its roles in `roles/`. The full name of a role is
`<namespace>.<collection>.<role>`.

```
ansible/dev_tools/
├── galaxy.yml            # namespace: acme, name: dev_tools
├── meta/runtime.yml      # requires_ansible
└── roles/git/
    ├── meta/main.yml     # the catalog's description and tags
    └── tasks/main.yml    # what installing does
```

```yaml
# ansible/dev_tools/galaxy.yml
namespace: acme
name: dev_tools
version: 1.0.0
authors: [Acme]
readme: README.md
```

```yaml
# ansible/dev_tools/roles/git/meta/main.yml
galaxy_info:
  description: Git, the version control system, from Homebrew
  galaxy_tags: [vcs]
dependencies: []
```

```yaml
# ansible/dev_tools/roles/git/tasks/main.yml
- name: Install git
  community.general.homebrew:
    name: git
    state: present
```

- Ansible allows only lowercase letters, digits and `_` in the namespace, the
  collection and the role: `git_extras`, not `git-extras`. A collection whose
  `galaxy.yml` has no valid `namespace` and `name` is not listed.
- The catalog shows the `label` of the role's `local-env.yml` (see below), or
  else its folder name, title-cased (`git_extras` shows as `Git Extras`),
  `galaxy_info.description` and `galaxy_tags`. A role without `meta/main.yml` is
  listed too, with no description.
- A folder of `ansible/` without `galaxy.yml` is a plain role, named by its
  folder (`ansible/git/`). It still works, but a collection is better: its roles
  have names that don't clash with the roles of other sources, and the
  collection installs without local-env
  (`ansible-galaxy collection install "git+<repo>#/ansible/<collection>"`).
- Write tasks that can run again: `local-env install` runs every picked tool
  each time, and Ansible only changes what isn't in the expected state.
- A task with `become: true` runs with sudo: `local-env install` then asks for
  the password first, and the catalog says so.
- `dependencies` name other roles, in any source, by their full name
  (`acme.dev_tools.git`). A role of the same collection can also be named by its
  short name (`git`). A role made of other roles can stand for a whole setup (a
  backend engineer's tools).
- A role can also depend on a role of a Galaxy collection
  (`geerlingguy.mac.dock`). Its collection then lists that collection in the
  `dependencies` of its `galaxy.yml`, with a version range:

  ```yaml
  # ansible/profiles/galaxy.yml
  namespace: acme
  name: profiles
  dependencies:
    geerlingguy.mac: '>=5.0.0,<6.0.0'
  ```

  `local-env install` installs the Galaxy collections of the roles it runs
  before the playbook, into `volumes/tools/collections/` in the home folder. It
  downloads each collection once: `local-env update` gets the latest version
  that the ranges allow, which the next `local-env install` applies. The
  dashboard lists a Galaxy role in the profile's details with a **Galaxy**
  badge, and a role that no source and no `galaxy.yml` has as **Missing**.

- Don't list the collections of your sources in the `dependencies` of
  `galaxy.yml`. local-env leaves them out, but `ansible-galaxy` outside
  local-env looks for them on Galaxy and fails. Role dependencies are enough.
- When a role's files change, the dashboard shows its tool as **Update
  available** until the next `local-env install`.
- Unpicking a tool doesn't uninstall it: local-env only adds. The next
  `local-env install` forgets it, and the dashboard no longer lists it as
  installed.

To try a role, commit it, run `local-env sources sync`, pick it in the catalog
and run `local-env install`.

### Profiles

A profile is a whole setup, picked at once: a role tagged `profile`, made of
other roles. It can include other profiles.

```yaml
# ansible/profiles/roles/backend/meta/main.yml
galaxy_info:
  description: Backend developer setup
  galaxy_tags: [profile]
dependencies:
  - acme.profiles.base # another profile
  - acme.databases.tableplus
  - acme.editors.jetbrains_toolbox
```

- People pick their profile on the dashboard's Profiles page, or with
  `local-env install backend`, which saves it. The command takes the role's
  short name (`backend`) or its full name (`acme.profiles.backend`), not its
  label: a label is for reading, and can be a sentence. The page lists every
  profile with its tools and stacks, and the sidebar shows the current one.
  Later, `local-env install` installs it again with the tools they picked.
  `local-env install backend --no-save` installs it once.
- The roles of the profile are locked on in the catalog. Profiles are not rows
  of the catalog.
- When two collections have a profile with the same short name, people type its
  full name: `local-env install acme.profiles.backend`. For plain roles of the
  same name in two sources, they type `local-env install <source>/backend`.
- A profile can have tasks of its own. Most only have dependencies.

### The name to show, and the stacks a tool needs

`local-env.yml`, next to `meta/`, holds what local-env reads of a role. Ansible
doesn't read this file. Its `label` is the name the dashboard and the CLI show,
in place of the folder name: `Backend`, not `backend`.

A role, or a profile, can need Docker stacks: Mailpit for the apps it installs,
a database for its client. List them in `stacks`.

```yaml
# ansible/profiles/roles/backend/local-env.yml
label: Backend
stacks:
  - mailpit # docker/mailpit of this source
  - shared/postgres # docker/postgres of the source named shared
```

- `local-env install` deploys the stacks of every tool it installs, profiles and
  their dependencies included, after asking once. `--yes` doesn't ask.
- Each stack is deployed once, from its stack template (`"type": 3`), and linked
  to it: it gets template updates like a stack deployed from Dockhand. A stack
  the user removes stays removed.
- A stack of the same name that is already deployed is left as it is.
- A variable without a default (`${NGROK_AUTHTOKEN:?Your ngrok token}`) is asked
  for first. The text after `?` is shown with the question. A name with `TOKEN`,
  `SECRET`, `PASSWORD` or `KEY` is typed masked, and Dockhand keeps it as a
  secret. Without a terminal, the stack isn't deployed.
- The catalog says which stacks a tool needs. The dashboard doesn't deploy them:
  `local-env install` does.

### Variables a tool needs

A role can need values from the user: an email for git, a choice of editor.
Declare them in `meta/argument_specs.yml`, the standard file of Ansible. Ansible
checks the values before the role runs. A missing required value or a value of
the wrong type stops the role with a clear message. Galaxy roles use the same
file, so the file is not specific to local-env.

```yaml
# ansible/dev_tools/roles/git/meta/argument_specs.yml
argument_specs:
  main:
    options:
      git_email:
        type: str
        required: true
        description: The email of your commits
      git_editor:
        type: str
        choices: [vim, nano, code]
        default: vim
        description: The editor that git opens
      git_sign_commits:
        type: bool
        default: false
        description: Sign your commits with your SSH key
```

```yaml
# ansible/dev_tools/roles/git/defaults/main.yml
git_editor: vim
git_sign_commits: false
```

- local-env reads only the entry point `main`. For each option, it reads `type`,
  `required`, `default`, `choices`, `description` and `no_log`. Without this
  file, local-env reads `argument_specs` in `meta/main.yml`, as Ansible does.
- Ansible does not apply the `default` of the spec. Put the same value in
  `defaults/main.yml`. The dashboard shows the default as the placeholder of the
  field. local-env does not ask for an input with a default, in the spec or in
  `defaults/main.yml`.
- A profile can give a value to one of its tools with `vars:` in its
  `dependencies`. local-env then does not ask for it, and does not replace it
  with a saved value. The sheet of the profile shows it disabled, with this
  value:

  ```yaml
  # ansible/profiles/roles/backend/meta/main.yml
  dependencies:
    - role: acme.dev_tools.git
      vars:
        git_editor: code
  ```

- Ansible's extra vars are global. A value is per variable name, and all the
  roles that declare this name get the same value. Give each variable the prefix
  of its role (`git_email`, not `email`), unless the roles must share it.
- The **Variables** button of the Tools and Profiles pages opens one form with
  the inputs of all the tools that the next install runs, one field for each
  variable. A field says which roles use it, and when two roles declare it
  differently. An option with `choices` gets a select. A `bool` gets a switch.
  An `int` or a `float` gets a number field. All other types get a text field.
  For a `list`, the user separates the items with commas, and local-env saves a
  list. For a `dict`, the user types a JSON object. A value stays saved when the
  user unpicks the tool: the **Saved** tab lists it.
- In a terminal, `local-env vars` lists the variables of the user's tools.
  `local-env vars set <name> <value>` saves a value, or asks for it, with the
  same checks as the form, and `local-env vars unset <name>` removes it.
- The dashboard saves the values in `volumes/tools/variables.json`.
  `local-env install` gives Ansible only the values of the inputs that the
  wanted roles declare (`--extra-vars`).
- If a required input has no value and no default, `local-env install` asks for
  it in the terminal and saves the answer. Without a terminal, the install stops
  before Ansible and names the inputs.
- local-env does not support secrets yet. It never shows, asks for or saves an
  option with `no_log: true`. If a wanted role requires one without a default,
  `local-env install` stops and names it. Do not use a required `no_log` option
  in a tool for local-env yet.
- When a value changes, the dashboard shows the roles that use it as **Update
  available**. A change of `argument_specs.yml` is a new revision of the role.

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
