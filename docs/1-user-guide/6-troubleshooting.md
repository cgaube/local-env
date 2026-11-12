# Troubleshooting

## Start with doctor

```sh
local-env doctor
```

It checks the DNS, the certificate, the proxy, Dockhand, your sources, their
templates and your logins. Each problem comes with what to do.

## A site does not open

- **The name does not resolve** (`https://mail.dev.test` is not found): the DNS
  is broken. Run `local-env setup` again: it repairs only what is broken.
- **The browser warns about the certificate:** run `local-env start`. It renews
  a certificate that is expired, or that is for another domain. If the warning
  stays, run `local-env setup`.
- **The page says "502" or does not load:** the container is stopped, or it does
  not listen on its `VIRTUAL_PORT`. Look at it in Dockhand.

## An app does not start: "network … not found"

Older versions of local-env removed their `local-env` network on
`local-env stop`. A container that was stopped then still points to the network
that was removed. Run `local-env start`, then remove the old network from the
container, and start it:

```sh
docker network disconnect -f local-env <container>
docker start <container>
```

local-env attaches it to the network again when it starts.

## "Outdated core services"

The services of local-env run an older version than the CLI: you updated
local-env, but did not restart them. Run `local-env start`.

## The install of a tool fails

- Read the task that failed: local-env shows its error under the tool.
- `local-env install --verbose` shows the full output of Ansible.
- **"not logged in"**: a tool reads a secret, and your session ended. Run the
  command that the message gives: see [Log in to your accounts](5-logins.md).
- **"A role needs your sudo password"**: the tool uses sudo, and local-env did
  not see it. Tell the team of the source, with the name of the tool.

## The dashboard cannot install

The **Install** button needs the dashboard agent, which `local-env start`
starts. Run `local-env start`, then try again.

## Start again from zero

```sh
local-env reset
```

It removes everything that local-env created: its services, its data and its DNS
setup. It asks before it removes the certificate authority of mkcert, which
other projects can use. Then run `local-env setup`.
