# local-env

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
