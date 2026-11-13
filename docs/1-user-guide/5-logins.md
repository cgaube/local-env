# Log in to your accounts

A source can need you to be logged in to some accounts. Its manifest declares
them, and local-env asks you to log in at the right time. There are three kinds:

| Kind            | Why                                                   | Where the login is kept             |
| --------------- | ----------------------------------------------------- | ----------------------------------- |
| A registry      | The templates use private images (`ghcr.io`, AWS ECR) | In Dockhand, which pulls the images |
| AWS             | A tool reads a secret from AWS Secrets Manager        | The AWS CLI keeps your SSO session  |
| HashiCorp Vault | A tool reads a secret from a Vault                    | The Vault CLI keeps your token      |

local-env never sees the secrets of your tools. The CLI of AWS or Vault reads
them for the tool.

## When something fails

A pull or a secret fails because a login has expired?

```sh
local-env login
```

It checks every login of every source and fixes what does not work: it logs in
to the AWS and Vault sessions that are logged out (your browser opens), asks for
the registry logins that are missing, and gets a new token for each AWS ECR
registry whose token is missing or has lived half of its 12 hours. A login that
works stays as it is. When it got a new ECR token, `local-env update` pulls the
latest images with it now.

A login has a name, `<source>/<name>`, as `sources list` shows it. Name one to
log in to it again, even when it works (another account, a new token):

```sh
local-env login acme/ghcr        # or `ghcr`, when only one source has a login named ghcr
local-env logout acme/ghcr
```

## See your logins

```sh
local-env sources list
```

Each login of a source has a line: `✔` when you are logged in, `▲` with the
command to run when you are not. `local-env doctor` checks them too.

The Overview of the dashboard shows the same: each source lists its logins and
their state, and **Needs attention**, at the top, gives the command to copy for
one that waits for you. It checks them when the page opens: after you log in,
click **Check logins**.

## Before the logins: the bootstrap

Some logins need something on your Mac first: a CLI, an AWS profile, a VPN
client. A source sets it up with its **bootstrap**, a few roles that local-env
runs before the logins. When you add the source, local-env asks:

```
acme has a bootstrap (AWS access). Run it now?
```

If you say no, `local-env install` and `local-env login` run it first. When its
roles change, `local-env update` and `local-env sources sync` ask again. To run
it yourself, even when it is done:

```sh
local-env sources bootstrap        # every source, or name one: acme
```

It can ask for your password, for the roles that need sudo, and for the values
the roles need (your AWS role, for example), which it saves. Change a value (in
the Variables sheet of the Tools page, or with `local-env vars set`) and the
next install runs the bootstrap again.

The Overview of the dashboard shows the bootstrap in the panel of its source,
and **Needs attention** says when it never ran or changed, with the command to
copy. `local-env doctor` says it too.

## Registries

When you add a source with private images, local-env asks for a username and a
token for each registry. `start`, `update` and `sources sync` ask again until
you log in, or pick "Don't ask again". Dockhand tests the login, then keeps it.

```sh
local-env login acme/ghcr        # asks for the username and the token
echo "$TOKEN" | local-env login acme/ghcr -u octocat --password-stdin
```

For `ghcr.io`, create a classic personal access token with the `read:packages`
scope only. Do not use the token of `gh auth token`: it can also push code.

### AWS ECR

An ECR registry asks for nothing: it uses an AWS login of the source. ECR tokens
last 12 hours, so `start`, `update`, `sources sync`, `deploy` and `install` get
a new one when the one in Dockhand has lived half of its 12 hours. If your AWS
session has ended, they offer to log you in, or tell you to run
`local-env login`.

While no local-env command runs, nothing breaks: running apps keep running.
Dockhand's automatic updates of ECR images wait until the next command gets a
token. A pull from Dockhand's own page fails until then: run `local-env login`.

## AWS

Your company gives you access to AWS with IAM Identity Center (SSO). When a tool
needs an AWS account, `local-env install`:

1. installs the AWS CLI, if you do not have it;
2. writes a profile for the account in `~/.aws/config`, named
   `local-env-<source>-<login>`. It never changes a profile that you wrote.
3. checks that you are logged in. If not, it asks "Log in now?", then opens your
   browser: you log in with your company account.

The session lasts as long as your company allows, often a working day. After
that, the next install asks again. To log in before:

```sh
local-env login acme/acme-dev
```

One login covers every account of your company's AWS access portal. To use the
account yourself: `aws --profile local-env-acme-acme-dev …` (`sources list`
shows the name).

Some sources use a profile that you set up yourself. If it is an AWS SSO profile
(`sso_session` in `~/.aws/config`), local-env logs you in to it as above. If it
uses a program (Granted's `credential_process`, `aws-vault`), the source's help
says how to log in: local-env only checks it, and never logs you out of it.

## HashiCorp Vault

When a tool needs a Vault, `local-env install` installs the Vault CLI if you do
not have it, checks your token, and offers to log in. Most companies use their
single sign-on: your browser opens.

```sh
local-env login acme/data-vault
```

The Vault CLI keeps one token. If you use two Vaults, logging in to one logs you
out of the other: the next install asks you to log in again.

## From the dashboard

The **Install** button of the dashboard does not log you in: a login opens a
browser or asks for a password, which belongs in your own terminal. If you are
not logged in, the install stops and shows the command to run. Run it, then
install again.
