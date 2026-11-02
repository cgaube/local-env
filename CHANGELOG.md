# local-env

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
