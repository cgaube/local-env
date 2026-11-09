# Log in to your accounts

A source can need you to be logged in to some accounts. Its manifest declares
them, and local-env asks you to log in at the right time. There are three kinds:

| Kind            | Why                                            | Where the login is kept             |
| --------------- | ---------------------------------------------- | ----------------------------------- |
| A registry      | The templates use private images (`ghcr.io`)   | In Dockhand, which pulls the images |
| AWS             | A tool reads a secret from AWS Secrets Manager | The AWS CLI keeps your SSO session  |
| HashiCorp Vault | A tool reads a secret from a Vault             | The Vault CLI keeps your token      |

local-env never sees the secrets of your tools. The CLI of AWS or Vault reads
them for the tool.

## See your logins

```sh
local-env sources list
```

Each login of a source has a line: `✔` when you are logged in, `▲` with the
command to run when you are not. `local-env doctor` checks them too.

The **Logins** card on the Overview of the dashboard shows the same: each login,
its state, and the command to copy. It checks them when the page opens: after
you log in, click **Refresh**.

## Registries

When you add a source with private images, local-env asks for a username and a
token for each registry. `start`, `update` and `sources sync` ask again until
you log in, or pick "Don't ask again". Dockhand tests the login, then keeps it.

```sh
local-env sources login acme                  # every login of the source acme
local-env sources login acme --login ghcr     # only this one
local-env sources logout acme
```

For `ghcr.io`, create a classic personal access token with the `read:packages`
scope only. Do not use the token of `gh auth token`: it can also push code.

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
local-env sources login acme --login acme-dev
```

One login covers every account of your company's AWS access portal. To use the
account yourself: `aws --profile local-env-acme-acme-dev …` (`sources list`
shows the name).

Some sources use a profile that you set up yourself (`aws-vault`,
`credential_process`): their help says how. local-env then only checks it.

## HashiCorp Vault

When a tool needs a Vault, `local-env install` installs the Vault CLI if you do
not have it, checks your token, and offers to log in. Most companies use their
single sign-on: your browser opens.

```sh
local-env sources login acme --login data-vault
```

The Vault CLI keeps one token. If you use two Vaults, logging in to one logs you
out of the other: the next install asks you to log in again.

## From the dashboard

The **Install** button of the dashboard does not log you in: a login opens a
browser or asks for a password, which belongs in your own terminal. If you are
not logged in, the install stops and shows the command to run. Run it, then
install again.
