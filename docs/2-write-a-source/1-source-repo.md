# Create a source

A template is an app that people deploy from the dashboard with one click: a
database, a mail catcher, an internal tool. You write templates in a git repo, a
**source**, and everyone who adds that source gets them, then gets your later
changes too.

## Start from the template

[local-env-templates-example](https://github.com/cgaube/local-env-templates-example)
is a source to copy: an example of each thing a source can have, with the checks
and the CI that go with it.

1. On GitHub, open it, click **Use this template**, then **Create a new
   repository**. Your repo gets the files, but not the history. It can be
   private.
2. In `local-env.yml`, set `name:` and `label:` (see
   [The manifest](#the-manifest)).
3. Replace the examples with your own templates, roles and profiles, and remove
   what you don't need. Give your collections your own `namespace:`, not `acme`.
4. Add your repo: `local-env sources add <your repo URL>`.

What it holds:

- **Docker templates:** `hello`, which builds its image when it deploys, and
  `greeting`, which asks for a value
  ([Docker templates](2-docker-templates.md)).
- **Tools:** Ansible roles that only print messages (one with `become`, one with
  inputs, one with a Galaxy dependency) and a profile
  ([Write tools and profiles](3-tools.md)).
- **The manifest**, with its logins and secrets commented out
  ([Tool secrets](5-secrets.md)).
- **Checks:** a git hook checks `docker/` before each commit, and
  `mise run ansible:check` tries the roles with `--check`.
- **Prebuilt images:** a GitHub workflow that builds an image and pushes it to
  ghcr.io, run by hand until you turn on its triggers.

To try it as it is:
`local-env sources add https://github.com/cgaube/local-env-templates-example`.

## A source repo

```
<repo>/
├── local-env.yml             # optional: the manifest (name, label, logins)
├── docker/
│   ├── templates.json        # the list of templates (Portainer format)
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
when the repo is on your Mac. `sources sync` pulls it, so the dashboard lists
the new templates, and offers the changes to the stacks deployed from your
templates. `sources sync <source>` does it for one source only.

### The manifest

`local-env.yml` at the root of the repo says what the source is, for everyone
who adds it:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/cgaube/local-env/main/schemas/source-manifest.json
name: acme-platform # unique: the name of the source on every Mac
label: Acme Platform # what the dashboard and the CLI show
```

The first line points your editor to the JSON schema of the manifest: it
completes the fields, shows their help and marks the mistakes. VS Code needs the
YAML extension (Red Hat). JetBrains IDEs read a `$schema:` key instead, which
local-env ignores too:

```yaml
$schema: https://raw.githubusercontent.com/cgaube/local-env/main/schemas/source-manifest.json
```

- `name` is required in a manifest: lowercase letters, digits and `-`.
  `sources add` uses it as the name of the source, and skips a repo whose name
  is already added. Pick a name that no other team uses.
- `label` is optional, free text. Without it, local-env shows the name.
- `logins` lists the accounts that your templates and tools need: registries of
  private images (see [Private images](2-docker-templates.md#private-images))
  and secret managers (see [Tool secrets](5-secrets.md)).
- `secrets` says where the secrets of your tools are, in those secret managers,
  by the name of the variable each one fills (see [Tool secrets](5-secrets.md)).
- Without a manifest, the source is named after the repo, and has no label, no
  logins and no secrets.
- Other sources name yours by its `name`: `acme-platform/postgres` in `stacks:`.
  Changing the name later breaks them, and users must remove and add the source
  again.
