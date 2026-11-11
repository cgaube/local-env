---
layout: home
hero:
  name: local-env
  tagline: A local development environment for macOS
  image:
    src: /logo.svg
    alt: local-env
  actions:
    - theme: brand
      text: Install local-env
      link: /user-guide/install
    - theme: alt
      text: Write a source
      link: /write-a-source/source-repo
features:
  - icon: 🔒
    title: An HTTPS proxy
    details:
      Every container with <code>VIRTUAL_HOST=name</code> is served at
      <code>https://name.dev.test</code>, with a certificate that your Mac
      trusts.
    link: /user-guide/everyday
  - icon: 📦
    title: A catalog of apps
    details:
      The Docker templates of your sources. One click deploys one, with its
      secrets from your vault, and its containers update on their own.
    link: /user-guide/apps
  - icon: 🛠️
    title: Tools
    details:
      The Ansible roles of your sources (Git, Node.js, a CLI…), which
      <code>local-env install</code> installs on your Mac.
    link: /user-guide/tools
  - icon: 📊
    title: A dashboard
    details:
      At <code>https://local-env.dev.test</code> — your apps and routes, your
      sources, your tools and your profile.
    link: /user-guide/everyday
---

local-env is a local development environment for macOS: an HTTPS proxy, a
catalog of apps deployed in [Dockhand](https://github.com/Finsys/dockhand), the
tools your team installs on every Mac, and a dashboard for all of them.

Your team's **sources** hold the templates and the tools: git repos that you add
with `local-env sources add`. local-env ships none.

## User guide

For everyone who runs local-env on their Mac.

- [Install local-env](1-user-guide/1-install.md)
- [Everyday use](1-user-guide/2-everyday.md)
- [Deploy apps](1-user-guide/3-apps.md)
- [Install tools](1-user-guide/4-tools.md)
- [Log in to your accounts](1-user-guide/5-logins.md)
- [Troubleshooting](1-user-guide/6-troubleshooting.md)

## Write a source

For the teams that give templates and tools to the others.

- [Create a source](2-write-a-source/1-source-repo.md): the repo and its
  manifest
- [Docker templates](2-write-a-source/2-docker-templates.md)
- [Write tools and profiles](2-write-a-source/3-tools.md)
- [Tool variables](2-write-a-source/4-variables.md)
- [Tool secrets](2-write-a-source/5-secrets.md): AWS Secrets Manager and
  HashiCorp Vault

## How it works

For the people who change local-env: each feature, how it works and why. Start
with [How local-env works](3-how-it-works/0-index.md).
