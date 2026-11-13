# Everyday use

## Start and stop

```sh
local-env start     # after a restart of your Mac
local-env stop
local-env status
```

local-env does not start with your Mac: run `local-env start` when you need it.
`start` also renews the certificate when it expires soon, and starts the
dashboard agent, which lets the dashboard install your tools.

## Keep it up to date

```sh
local-env update
```

`update` updates everything, in this order: local-env itself (with Homebrew),
its services, your sources, the stacks deployed from their templates, and the
images of your containers. When a template changed, it shows the change and asks
before it applies it. Your own edits to the stack are kept.
`local-env update --dry-run` only shows what would change.

local-env tells you when a new version is out, at most once a day.

## The dashboard

`https://local-env.dev.test` shows:

- **Overview**: the services of local-env, your sources and what each one holds,
  and your logins.
- **Profiles**: the sets of tools for each job. Pick yours there.
- **Tools**: every tool of your sources. Pick the ones you want, set their
  variables, and install them.
- **Docker**: the templates of your sources, to deploy (see
  [Deploy apps](3-apps.md)), and every route of the proxy, with a link to each
  app.

Press `⌘K` (or click the terminal button beside the theme switcher) to run
`local-env install` or `local-env update` from any page, or to go to a page.

Dockhand, at `https://docker.dev.test`, manages your containers and stacks.

## Sources

```sh
local-env sources list                # your sources, what they hold, their logins
local-env sources sync                # pull them, and apply the changes of their templates
local-env sources remove <source>
local-env sources links               # the stacks you deployed, and the template of each
```

`sources sync` is what you run after your team changes a template. `update` does
it too, with everything else.

## Every command

| Command                            | What it does                                           |
| ---------------------------------- | ------------------------------------------------------ |
| `setup`                            | Set up the domain, the certificate and the DNS         |
| `start` / `stop` / `status`        | Start, stop or show the services of local-env          |
| `update`                           | Update local-env, its services, the sources and stacks |
| `sources add <repo>`               | Add a source: a git URL or a git repo on your Mac      |
| `sources list` / `remove`          | Show or remove your sources                            |
| `sources sync [source]`            | Pull the sources and apply the changes of templates    |
| `sources links`                    | Show the deployed stacks and their templates           |
| `login` / `logout [login]`         | Fix the logins that do not work, or log out of one     |
| `deploy [template]`                | Deploy a template of your sources in Docker            |
| `install [profile]`                | Install your profile and the tools you picked          |
| `vars` (`list`, `set`, `unset`)    | Show or set the variables of your tools                |
| `proxy routes`                     | Show the hosts that the proxy serves                   |
| `config get` / `set <key> <value>` | Read or change a setting, and apply it                 |
| `doctor`                           | Check everything, and tell what to do                  |
| `reset`                            | Remove everything that local-env created               |

`local-env <command> --help` gives the options of each command.
