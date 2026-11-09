# local-env

local-env is a local development environment for macOS. It gives your Mac:

- **An HTTPS proxy.** Every container with `VIRTUAL_HOST=name` is served at
  `https://name.dev.test`, with a certificate that your Mac trusts.
- **A catalog of apps.** [Dockhand](https://github.com/Finsys/dockhand), at
  `https://docker.dev.test`, lists the Docker templates of your sources. One
  click installs a template, and its containers update on their own.
- **Tools.** The Ansible roles of your sources (Git, Node.js, a CLI…), which
  `local-env install` installs on your Mac.
- **A dashboard,** at `https://local-env.dev.test`: your routes, your sources,
  your tools and your profile.

Your team's **sources** hold the templates and the tools: git repos that you add
with `local-env sources add`. local-env ships none.

## User guide

For everyone who runs local-env on their Mac.

- [Install local-env](1-user-guide/1-install.md)
- [Everyday use](1-user-guide/2-everyday.md)
- [Install tools](1-user-guide/3-tools.md)
- [Log in to your accounts](1-user-guide/4-logins.md)
- [Troubleshooting](1-user-guide/5-troubleshooting.md)

## Write a source

For the teams that give templates and tools to the others.

- [Create a source](2-write-a-source/1-source-repo.md): the repo and its
  manifest
- [Docker templates](2-write-a-source/2-docker-templates.md)
- [Write tools and profiles](2-write-a-source/3-tools.md)
- [Tool variables](2-write-a-source/4-variables.md)

## How it works

For the people who change local-env: each feature, how it works and why. Start
with [How local-env works](3-how-it-works/0-index.md).
