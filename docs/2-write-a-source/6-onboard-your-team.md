# Onboard your team

A new employee needs Homebrew, local-env, your source and the tools of their
job. One script can do all of it, and your team gets it in one command to paste
in a terminal:

```sh
/bin/bash -c "$(curl -fsSL https://example.com/local-env/onboarding.sh)"
```

The script is
[`onboarding.sh`](https://github.com/cgaube/local-env-templates-example/blob/main/onboarding.sh)
in the template source: a source made from the template has it already (see
[Create a source](1-source-repo.md)).

## Set it up

1. In `onboarding.sh`, set the values at the top:
   - `LOCAL_ENV_SOURCE_URL`: the git repo of your source.
   - `LOCAL_ENV_DOMAIN`: the domain of the local apps, `dev.test` by default.
     The script sets it on the first run only.
   - `LOCAL_ENV_PROFILE`: the profile to install, by name. Empty, the employee
     picks one.

   They are defaults: an environment variable of the same name wins, so a script
   of yours that runs this one can set them
   (`LOCAL_ENV_PROFILE=backend /bin/bash -c "$(curl …)"`, or
   `export LOCAL_ENV_PROFILE=backend`).

2. Serve it where a new Mac can download it without a login. A public repo can
   use the raw URL of the file
   (`https://raw.githubusercontent.com/<owner>/<repo>/main/onboarding.sh`). The
   raw URL of a private repo needs a login: copy the file to your intranet or to
   a public page.
3. Give your team the command, with your URL.

To try it with the template source:

```sh
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/cgaube/local-env-templates-example/main/onboarding.sh)"
```

## What the script does

1. It checks the Mac: macOS on Apple Silicon, in a terminal.
2. It installs Homebrew when it is missing, and adds it to `~/.zprofile` for the
   next terminals.
3. It checks that Docker runs. A Docker engine that runs is kept. Otherwise, it
   installs Colima (free) with Homebrew's `docker` CLI, Docker Compose and
   Buildx, and starts it. To use another engine (OrbStack, Docker Desktop),
   install and start it before the script, from a script of yours that then runs
   this one, or change `ensure_docker` in your copy.
4. It installs local-env with Homebrew, or upgrades it.
5. It hands over to `local-env onboard <source> --domain <domain>`
   (`--profile <profile>` when you set one), which does the rest in one flow:
   - `local-env setup --yes`: the DNS and the certificate. The domain applies on
     the first run only: a Mac set up before keeps its own.
   - `local-env sources add`: your source. Skipped when it is already added.
   - `local-env start`: the core services, then the logins of your source.
   - `local-env install`: the profile you set, or the one the employee picks. On
     the next runs, it installs the saved profile again.

   It ends with what it installed and the address of the dashboard.
   `local-env onboard` is not in `local-env --help`: it is for this script, and
   the everyday commands are `start`, `update` and `install`.

The employee types their password for Homebrew, the DNS and the certificate, and
for the tools that need sudo. The Homebrew installer needs an administrator
account: when your employees are standard users, install Homebrew with your Mac
management tool first, and the script skips that step. A private source repo
asks for their git login, and the logins of your source (registries, secret
managers) are asked as usual: see [Secrets](5-secrets.md).

Run the script again at any time: each step skips what is already done. When a
step fails (Docker is not started, the git login is wrong), the script says what
to fix, and the next run goes on from there. At the end, the employee opens a
new terminal: the one that ran the script does not find `brew` and `local-env`
when the script installed them.

## Why `bash -c "$(curl …)"`

With `curl … | bash`, the script comes on the standard input, where the
questions would read their answers. The script works both ways: then the
commands that ask questions read the terminal's own device (`/dev/ttys003`, not
`/dev/tty`, which macOS can't watch with kqueue). But `bash -c "$(curl …)"`
downloads the whole script before it runs, as the Homebrew installer does.

The script is in functions that its last line runs, so a download cut in the
middle runs nothing.
