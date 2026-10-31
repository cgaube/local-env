---
'local-env': minor
---

First release of local-env, a local development environment for macOS:

- HTTPS proxy: every container with `VIRTUAL_HOST=name` is served at
  `https://name.dev.test`, with a trusted local certificate.
- App catalog: Dockhand at `https://docker.dev.test` lists the Docker templates
  of your sources. Deployed stacks stay in sync with their template, and your
  own edits are kept.
- Sources: git repos of Docker templates, added with `local-env sources add`.
