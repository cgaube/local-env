# local-env

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
