# local-env

## 0.7.1

### Patch Changes

- c82c665: When the dashboard agent can't start (its port is taken, or it
  crashes), `local-env start` says so at once, with the end of the agent's log,
  instead of waiting 10 seconds and pointing to the log.
- c77f2bc: A variable in a comment of a compose file (`# set ${GREETING:?…}`) is
  no longer asked for at deploy, read from the vault or shown on the dashboard
  card: compose doesn't read comments either.

## 0.7.0

### Minor Changes

- 7ac1eb5: Tools can get secrets from AWS Secrets Manager and HashiCorp Vault. A
  source declares its `aws` and `vault` logins and its `secrets` in its
  manifest, and `local-env install` logs you in, then gives each role the
  secrets it declares as inputs, without writing them to the disk.
- f5e7588: `local-env install --dry-run` shows what would install and the
  variables it would use, without running anything.
- cda8278: The dashboard's Overview starts with what needs you: a stopped
  service or agent, a logged-out account, tools to install, each with what to
  do. The core services are a compact Health card, and each source lists its
  logins and their state.
- d8e0645: Registries of private images move from `docker/registries.json` to
  the `logins` of the source manifest (`local-env.yml`), as logins of
  `type: registry`. `local-env sources login` and `logout` take
  `--login <name>`, the name of the login in the manifest, in place of
  `--registry <host>`.
- f5e7588: Tools can take variables, which their role declares in
  `meta/argument_specs.yml`. Set them in the dashboard (Variables, beside
  Install) or with `local-env vars set`, and `local-env install` asks for a
  required one that has no value. A value that your profile sets wins. Secrets
  (`no_log`) are not supported yet.
- d8e0645: A source can have a manifest, `local-env.yml` at the root of its
  repo, with a unique `name` and a `label`. `local-env sources add` names the
  source after the manifest, the same on every Mac, and skips a repo whose name
  is already added. `sources list` and the dashboard show the label.
- e4cfd70: Deploy the Docker templates of your sources from the dashboard's
  Docker page, or with `local-env deploy`. A deploy asks for the values only you
  can give, and reads secrets from AWS Secrets Manager or HashiCorp Vault (the
  source's manifest maps a compose variable to a secret). Dockhand's Templates
  page is hidden, and your sources are no longer listed there. A template card
  and `local-env deploy` say when Dockhand would show a secret in clear in its
  pages.

### Patch Changes

- cda8278: `local-env start` replaces a dashboard agent that runs another
  local-env (a binary built again, or Homebrew's beside a checkout), not only
  one of another version.
- a2550c4: The dashboard shows an error page when a page breaks, in place of a
  blank screen: a broken logo, the error, and buttons to try again or go back to
  the overview.
- d8e0645: `local-env install` lists the tools that left your sources once, at
  the end with the tools no longer wanted, and no longer lists a profile that
  left your sources as a tool.
- f5e7588: `local-env install` shows a line for each item of a loop, as Ansible
  does.

## 0.6.1

### Patch Changes

- 2f5aeed: Update dependencies.

## 0.6.0

### Minor Changes

- 4a276bc: `local-env setup` now ends by asking "Start local-env now?", so a new
  setup ends with Dockhand running and configured. `setup --yes` doesn't start
  it.
- 4a276bc: Hide the Dockhand pages local-env users rarely need (Activity,
  Registry, Schedules, Images, Volumes, Networks) from its sidebar on a fresh
  setup. A sidebar you already changed is kept, and Dockhand's sidebar settings
  show the pages again.

## 0.5.0

### Minor Changes

- db05fec: Install and update from the dashboard. Install is in the header of
  the Tools and Profiles pages, and turns primary with a count when changes
  wait; Update is in the version menu of the sidebar. Each opens a terminal in
  the page and runs the command on your Mac, where you answer its questions and
  type the sudo password. `local-env start` starts the dashboard agent that runs
  them, and `local-env stop` stops it. The core services no longer restart on
  their own: after a restart of your Mac, run `local-env start`.

### Patch Changes

- 4119e28: `local-env update` shows a spinner while it checks for image updates,
  updates containers and prunes old images.
- ce1d845: `local-env install` gives the sudo password to Ansible on its stdin,
  so the password is never written to the disk. A password that starts or ends
  with a space now works, and an empty password asks again. When a role needs
  sudo but local-env did not ask for the password, the install names the role.

## 0.4.0

### Minor Changes

- c08dbb4: Tools can come from Ansible collections:
  `ansible/<collection>/galaxy.yml` and its `roles/`. Roles are named
  `<namespace>.<collection>.<role>` and depend on each other by that name.
  `local-env install` gives Ansible every collection of your sources. The
  dashboard and the CLI show the `label` of a role's `local-env.yml`, or else
  its folder name, title-cased. `local-env install` takes a profile's short name
  or full name, and shows it beside the label. Plain roles in `ansible/<role>/`
  still work.

  `local-env install` with no profile and no picked tools now asks for your
  profile in the terminal, and no longer opens the dashboard.

  The Tools page of the dashboard shows the Ansible role of each tool, in place
  of the date it was installed.

  Roles can now use roles from Galaxy collections. Add the collection and a
  version range to the `dependencies` of your collection's `galaxy.yml`.
  `local-env install` downloads it once, before it runs your tools, and
  `local-env update` upgrades it to the newest version that the range allows.
  local-env keeps these collections in its own folder and ignores
  `~/.ansible/collections`, so every Mac runs the same versions. In the
  dashboard, the details of a profile list its Galaxy roles, and mark a role
  that no source or collection has as Missing.

  The dashboard shows a toast at the top center while tools wait for
  `local-env install`, with the command. Its Details button opens the list of
  tools and the command to copy. It replaces the Install button of the header.

  `local-env install <profile>` asks before it replaces your saved profile.
  `--yes` switches without asking.

- 9a812c2: Profiles: a source can group its tools into a profile, an Ansible
  role tagged `profile`. Install one with `local-env install <profile>`, which
  saves it: later, `local-env install` installs it again with the tools you
  picked (`--no-save` installs it once). The dashboard has a Profiles page to
  compare profiles and pick yours, with their tools and stacks; the sidebar
  shows your profile, and its tools are locked on in the Tools page.

  A tool can also need Docker stacks (`local-env.yml`). `local-env install`
  deploys the missing ones once, linked to their template, after one question
  (`--yes` doesn't ask), and asks for the variables they can't start without.
  `local-env install` also removes your sudo password when you stop it with
  Ctrl-C.

  The dashboard uses the sidebar-07 layout: the sidebar collapses to its icons,
  and each page has its own header.

- a7a8daa: Sources can list the registries of their private images in
  `docker/registries.json`. local-env asks for a login for each registry that
  has none, and Dockhand uses it to pull the images. New commands:
  `local-env sources login` and `local-env sources logout`. Without a name,
  `sources login` lists the sources that need a login, and their login.
  `local-env sources list` shows whether each source is logged in.
  `local-env doctor` tests each login.

### Patch Changes

- 689552d: Refuse source and template names that point outside the local-env
  folder, such as `../` or an absolute path.

## 0.3.2

### Patch Changes

- 45b575c: `local-env update` runs `brew update` before
  `brew upgrade local-env`, so Homebrew sees the new version. When Homebrew
  installs no new version, `update` tells you.

## 0.3.1

### Patch Changes

- 3f57557: `setup` trusts the local certificate authority for your user, without
  sudo. This works on managed Macs that block the system trust settings. If the
  CA cannot be trusted, setup continues and shows the command to run. Restart
  Firefox if it warns about a local-env site.

  Dockhand now uses port 17300 on your Mac, not 3000. An app on port 3000, such
  as Rails or Next.js, no longer stops `local-env start`. If another app uses
  port 17300, `start` tells you so.

## 0.3.0

### Minor Changes

- 14ad754: Say when a new version of local-env is out: the CLI checks the
  Homebrew formula at most once a day, and the dashboard shows it in the version
  menu. `local-env update` now installs it first, with Homebrew, then updates
  the rest on the new version.
- 14ad754: Install tools on your Mac from the Ansible roles of your sources. The
  dashboard's Tools page lists every role of every source: pick the ones you
  want there, then run `local-env install`, which installs them with Ansible.
  Its status filter shows what is installed and what changed since.
  `local-env setup` now installs Ansible with the other Homebrew packages.

## 0.2.0

### Minor Changes

- b9c3296: A new dashboard at `https://local-env.<domain>`, with a sidebar: an
  overview of your apps and core services, the Docker routes with help to add
  one, your sources, and the coming Tools section (a catalog of what your
  sources can install on your Mac). `local-env start` ends with its URL.

## 0.1.1

### Patch Changes

- f2f2038: Check `config.json` and `template-links.json` when they are read. An
  invalid domain or build port now stops with an error that names the file and
  the `local-env config set` command that fixes it. An invalid link is ignored
  with a warning, and the next sync links that stack again.

## 0.1.0

### Minor Changes

- 7abc185: First release of local-env, a local development environment for
  macOS:

  - HTTPS proxy: every container with `VIRTUAL_HOST=name` is served at
    `https://name.dev.test`, with a trusted local certificate.
  - App catalog: Dockhand at `https://docker.dev.test` lists the Docker
    templates of your sources. Deployed stacks stay in sync with their template,
    and your own edits are kept.
  - Sources: git repos of Docker templates, added with `local-env sources add`.
