# Logins

Status: done. The logins live in the [source manifest](source-manifest.md).

## What it does

A **login** is an account that a source needs the user to be signed in to. A
source declares its logins once, in its **manifest**: `local-env.yml` at the
root of the source. local-env checks them, asks the user to log in when one is
missing, and shows their state.

There are three types of login:

| Type       | For                                      | The credential                                  |
| ---------- | ---------------------------------------- | ----------------------------------------------- |
| `registry` | Private images of the source's templates | A token that the user types. Dockhand keeps it. |
| `aws`      | AWS Secrets Manager, read by roles       | The AWS CLI's SSO session (`~/.aws/sso/cache`)  |
| `vault`    | HashiCorp Vault, read by roles           | The Vault CLI's token (`~/.vault-token`)        |

local-env never keeps an AWS or a Vault secret. Roles read their secrets with
the vendor's CLI, which uses the session. local-env makes sure that the CLI is
installed, configured and logged in **before** anything runs.

```yaml
# <source>/local-env.yml
name: acme-platform
label: Acme Platform
logins:
  ghcr:
    type: registry
    host: ghcr.io
    usernameHelp: your GitHub username
    tokenHelp: a classic token with read:packages
  acme-dev:
    type: aws
    region: eu-west-1
    sso:
      startUrl: https://acme.awsapps.com/start
      region: eu-west-1
      accountId: '123456789012'
      roleName: DevSecretsRead
    help: Request the dev account in #platform
  data-vault:
    type: vault
    address: https://vault.data.acme.io
    namespace: dev
    method: oidc
    role: developer
    help: Ask #data for the developer role
```

- `name` and `label` belong to the [source manifest](source-manifest.md).
  `logins` maps a login name to a login. A login name is lowercase letters,
  digits and `-`, unique in its source.
- A role declares the **secrets** it reads in its own `local-env.yml`: a name,
  the login, the secret (`ref`) and the key to take (`field`). A task reads one
  by its name, with the lookup that local-env ships:

  ```yaml
  # ansible/…/roles/github/local-env.yml
  secrets:
    GITHUB_TOKEN: { login: acme-dev, ref: platform/dev/github, field: token }
  ```

  ```yaml
  - name: Save the GitHub token
    ansible.builtin.command: gh auth login --with-token
    args:
      stdin: "{{ lookup('local_env.core.secret', 'GITHUB_TOKEN') }}"
    no_log: true
  ```

- `login: acme-dev` finds the login in the role's own source first, then in any
  source. `acme-platform/acme-dev` names the source.
- A role that runs the CLI for more than a secret (`aws s3 sync`) names the
  login in `logins: [acme-dev]`, and its tasks use the login's environment, in
  the extra var `local_env_logins`:
  `environment: "{{ local_env_logins['acme-dev'].env }}"`.

- A registry login is not named by anything. The images of the templates need
  it.
- `local-env install` handles the logins of the wanted roles before the
  playbook: it installs the CLI, configures it, checks the session, and logs in.
- `local-env sources login [source] [--login <name>]` logs in to the logins of a
  source. `local-env sources logout [source] [--login <name>]` logs out. Without
  a source, both list the sources and the state of their logins. They show the
  AWS profile of each `aws` login, for the user's own `aws` commands.
- `local-env sources list` shows if each source with logins is logged in.
  `local-env doctor` checks every login.
- `start` and `sources sync` ask for the missing registry logins, as before.
  They do not ask for AWS or Vault logins: they read no secret.
- `local-env sources remove` removes the AWS profiles that only this source
  used.
- The dashboard never logs in and never takes a credential.

## How it works

### The files

```mermaid
flowchart LR
  manifest["&lt;source&gt;/local-env.yml<br/>name, label, logins"] -->|names| role["ansible/…/roles/&lt;role&gt;/local-env.yml<br/>secrets: { name: login, ref, field }<br/>logins: [acme-dev]"]
  manifest -->|type: registry| dockhand[(Dockhand registries)]
  manifest -->|type: aws| awscfg["~/.aws/config<br/>[sso-session local-env-…] + [profile local-env-&lt;source&gt;-&lt;login&gt;]"]
  manifest -->|type: vault| vaulttoken["~/.vault-token<br/>(written by vault login)"]
  role --> extra["extra vars local_env_secrets, local_env_logins<br/>(run folder)"]
  extra --> lookup["lookup local_env.core.secret<br/>(ansible/local_env/core, linked into the run)"]
  state["volumes/logins.json<br/>not asked, written profiles"] -.-> manifest
```

- `services/dashboard/source-manifest.ts` reads the manifest
  ([Source manifest](source-manifest.md)). This feature uses its `logins`.
- `apps/cli/src/logins/types.ts` defines a `LoginType`: `parse` (the YAML entry
  to a typed login, or an error that names the field), `identity` (the key that
  makes two declarations one account) and `title`. A `SessionLoginType` (aws,
  vault) adds what its CLI needs, as data: `cli` (the binary and its Homebrew
  formula), `env`, `configure` (writes the config that is no secret,
  idempotent), `statusCommand` and `describeSession`, `loginCommand`,
  `logoutCommand`, `help`, `facts` (what a role gets beside `env`) and
  `secretCommand` (the command that prints one secret, and the keys to take from
  its JSON output).
- `secrets.ts` reads a secret reference (`login`, `ref`, `field`) and checks the
  names. It is not tied to roles: Docker stacks will use the same references.
- `session.ts` runs them: `sessionStatus` (`logged-in`, `logged-out`, `no-cli`),
  `logInToSession` and `logOutOfSession` with the terminal handed over, and the
  line that the lists show. `canLogIn` is false without a terminal, and in a run
  of the dashboard agent, which sets `LOCAL_ENV_FROM_DASHBOARD=1`.
- `declared.ts` reads the logins of the manifests: by type (`readSourceLogins`,
  `listAccounts`, one entry for each account), or by name (`findSourceLogin`).
  `listing.ts` gives the lines of `sources list`, `sources login` and `logout`.
- `wanted.ts` resolves the logins that the roles name and the secrets they read,
  and makes the logins ready before the playbook (`prepareLogins`). `index.ts`
  lists the types and checks the logins of a manifest (`checkManifestLogins`),
  for `sources add` and `doctor`.
- `registry.ts`, `aws.ts` and `vault.ts` implement the types. `ini.ts` edits the
  sections of `~/.aws/config`.
- `volumes/logins.json` in the home folder keeps the logins that the user does
  not want to be asked about again (by identity), and the AWS profiles and
  sso-sessions that local-env wrote.

The identity of each type:

| Type       | Identity                         | Two declarations with the same identity… |
| ---------- | -------------------------------- | ---------------------------------------- |
| `registry` | the host (`ghcr.io`)             | share one Dockhand login                 |
| `aws`      | the source name + the login name | are the same login                       |
| `vault`    | address + namespace              | share one token                          |

### The lookup and the extra vars

`local-env install` writes into the extra vars of the run (the file in the run
folder, mode 0600) how to reach each account and how to read each secret. There
is no secret in it.

```yaml
local_env_secrets:
  acme.dev_tools.github: # the role's full name: ansible_role_name
    GITHUB_TOKEN:
      title: platform/dev/github token, acme-dev # for the errors
      argv:
        [
          aws,
          secretsmanager,
          get-secret-value,
          --secret-id,
          platform/dev/github,
          --query,
          SecretString,
          --output,
          text,
        ]
      keys: [token] # taken from the JSON output; none: the output as it is
      env:
        { AWS_PROFILE: local-env-acme-platform-acme-dev, AWS_REGION: eu-west-1 }
      hint:
        'If your session ended: local-env sources login acme-platform --login
        acme-dev'
```

- The lookup (`ansible/local_env/core/plugins/lookup/secret.py`) finds the
  secrets of the role that runs the task by `ansible_role_name`, runs the
  command with the environment, takes the keys, and returns the value as unsafe
  text: Ansible never templates it again. It fails with the CLI's error and the
  hint.
- The command comes from the login's type (`secretCommand`): the plugin knows no
  provider. A new type needs no change in Python.
- local-env ships the collection `local_env.core` in its binary, writes it to
  the home folder with the core stack, and links it first into the collections
  of each run (`linkCollections` in `apps/cli/src/core/tools.ts`).
- Two roles of one run with the same full name, when one of them has secrets,
  stop the install: the lookup could not tell them apart.

`local_env_logins` holds the logins that the roles name in `logins:`:

```yaml
local_env_logins:
  acme-dev:
    type: aws
    profile: local-env-acme-platform-acme-dev
    region: eu-west-1
    env:
      { AWS_PROFILE: local-env-acme-platform-acme-dev, AWS_REGION: eu-west-1 }
  data-vault:
    type: vault
    address: https://vault.data.acme.io
    namespace: dev
    env: { VAULT_ADDR: https://vault.data.acme.io, VAULT_NAMESPACE: dev }
```

- The key is the login as the role names it: `acme-dev`, or
  `acme-platform/acme-dev`. Ansible's extra vars are global: a key has one value
  for the whole run.
- If two roles name `acme-dev` and it finds a different login for each (two
  sources declare `acme-dev`), the install stops before anything runs. It names
  the roles and the sources. The roles must name the source:
  `acme-platform/acme-dev`.

### Before the install

```mermaid
flowchart TD
  plan["Plan the stacks, confirm"] --> galaxy["Galaxy collections"]
  galaxy --> inputs["Check the required variables"]
  inputs --> collect["Secrets and logins of the wanted roles<br/>(own source first, then any source)"]
  collect --> clash{"a secret not valid, a login missing<br/>or a registry, one name for two logins?"}
  clash -- yes --> stopclash["Stop: name each problem"]
  clash -- no --> cli{"CLI installed?"}
  cli -- no --> brew["brew install awscli / hashicorp/tap/vault"]
  brew --> configure
  cli -- yes --> configure["configure: write the ~/.aws/config sections"]
  configure --> status{"status"}
  status -- logged-in --> sudo
  status -- logged-out --> ask{"canLogIn?"}
  ask -- yes --> login["Log in now?<br/>runs aws sso login / vault login<br/>with the terminal handed over"]
  login --> status
  ask -- "no terminal, or the dashboard" --> stop["Stop before anything runs:<br/>show the command and the help"]
  sudo["sudo password, then the missing variables"] --> playbook["ansible-playbook<br/>extra vars local_env_secrets, local_env_logins"]
  playbook --> stacks["Deploy the stacks"]
```

- One account is checked once per run, even if ten roles need it. AWS profiles
  that share an sso-session need one login.
- The login runs with stdio inherited: the browser, an MFA prompt or a password
  goes between the user and the vendor's CLI. local-env does not read that
  output.
- When the user declines the login, the install stops before Ansible and names
  the roles that need it.
- The logins come after the check of the variables, so that a run that cannot
  start asks nothing, and before the sudo password, so that a login that fails
  wastes no typing.
- A missing CLI is installed without a question, like the Galaxy collections:
  the install needs it. If `brew` is missing too, the install stops.
- Each install removes the sections of `~/.aws/config` that local-env wrote for
  a login that no source declares any more. `sources remove` does it too.

### The `aws` type

- `cli`: `aws` (`brew install awscli`).
- `configure`, when the login has `sso`: local-env writes two sections in
  `~/.aws/config` (or `$AWS_CONFIG_FILE`) and keeps the rest of the file:
  - `[sso-session local-env-<hash of start URL and SSO region>]`. All the logins
    of one Identity Center share it: one browser login covers all their accounts
    and roles.
  - `[profile local-env-<source>-<login>]`, for example
    `local-env-acme-platform-acme-dev`. The source name is unique and the same
    on every Mac, so the profile name is too.

  local-env records the sections in `volumes/logins.json`. It rewrites them on
  each install, and removes the ones that no login uses any more. It never
  changes a section that it did not write.

- Without `sso`, the login names the user's own profile (`profile: acme`):
  `credential_process`, aws-vault or keys. local-env writes nothing.
- `env`: `AWS_PROFILE` and `AWS_REGION`.
- `status`: `aws sts get-caller-identity --profile <profile>`. Exit 0 is logged
  in.
- `logIn`: `aws sso login --profile <profile>`. Without `sso`, local-env shows
  the `help` and the command that failed.
- `logOut`: `aws sso logout --profile <profile>`.

### The `vault` type

- `cli`: `vault` (`brew install hashicorp/tap/vault`).
- `configure`: nothing. The CLI has no config file for the address.
- `env`: `VAULT_ADDR`, and `VAULT_NAMESPACE` when the login has a `namespace`.
- `status`: `vault token lookup`, with the `env`. Exit 0 is logged in.
- `logIn`: `vault login -method=<method> [-path=<mount>] [role=<role>]`, with
  the `env`. `method` is `oidc` by default.
- `logOut`: `vault token revoke -self`, with the `env`. The token file stays,
  with a token that no longer works.

### The `registry` type

The code is in `apps/cli/src/logins/registry.ts`: it asks Dockhand if a login of
the host exists, asks for a username and a token, tests them with Dockhand and
saves them there. `registryLoginsStep` is the provisioning step of `start` and
`sources sync`. A registry login has no `env`: a role cannot name it.

- The identity is the full host: `ghcr.io/team-a` and `ghcr.io/team-b` are one
  login, as Docker keeps one login for each host.
- `sources login acme --login ghcr` (the name in the manifest) logs in to one
  login of the source. It replaced `--registry <host>`.
- "Don't ask again" is `registry:<host>` in `volumes/logins.json`.
- `sources add` refuses a manifest whose logins are not valid
  (`checkManifestLogins`): an unknown `type`, a missing `host`. A login that is
  not valid in a source pulled later is left out.

### Tests

`aws` and `vault` are faked binaries (`tests/support/fake-bin.ts`).
`tests/unit/ansible/secret-lookup.test.ts` runs the lookup with the real Ansible
(skipped without it). A login that opens a session is a rule with
`touch: <file>`, and the status after it is a rule with `ifFile: <file>`.
`tests/e2e/commands/logins.test.ts` covers the install, `sources login`,
`logout`, `list`, `remove` and `doctor`. The `aws` type was also checked by hand
against MiniStack, with the real AWS CLI and Ansible: a role read a secret with
only `environment: "{{ local_env_logins['acme-dev'].env }}"`.

## Why

- **One manifest per source.** A source had `docker/registries.json`, and the
  secret managers needed a file too. A registry and a secret manager are the
  same thing for the user: an account to sign in to, declared by the source,
  checked, shared by the sources that use it. The manifest at the root serves
  the templates and the roles, and it has room for what a source says about
  itself (`label`). It is YAML, like the `local-env.yml` of a role.
- **Company vaults, not a store of local-env.** Companies keep their secrets in
  a vault already, with SSO, audit and rotation. A copy in local-env (or in the
  Keychain) is a second place to rotate and to protect.
- **The vendor's CLI owns the session.** The CLI handles SSO, MFA, profiles and
  `credential_process` as the company set them up. local-env holds no vault
  credential, and the compiled binary needs no SDK.
- **A role declares its secrets, not only its logins.** A login is an account; a
  role needs values from it. With `secrets:`, the references sit in one file
  that local-env reads before the run: it knows which logins to make ready (it
  cannot read lookups out of tasks), checks every reference, and the tasks only
  name the secret. A team that moves to another manager changes the manifest and
  the `local-env.yml` of its roles, not their tasks.
- **One reference for roles and stacks.** `{ login, ref, field }` is the shape a
  Docker stack will use for its variables. One way to write a secret, and one
  `secretCommand` per type, whatever reads it.
- **local-env's lookup, not Ansible's.** The lookups of Ansible
  (`amazon.aws.secretsmanager_secret`, `community.hashi_vault`) need `boto3` and
  `hvac` in Ansible's Python. Homebrew's Ansible has neither, and a role cannot
  install them for the run it is in. local-env's lookup runs the vendor's CLI:
  it needs only the binary, which local-env installs.
- **The provider's logic stays in TypeScript.** The lookup runs the command that
  local-env gives it. A provider is written once, tested with the CLI's tests,
  and the stacks will run the same commands.
- **The lookup reads the value during the run, local-env does not pass it.** A
  value in the extra vars would be on the disk, in the run folder, for the whole
  run. The lookup reads it when a task needs it, and keeps it out of templating.
- **`logins:` stays, for the CLI itself.** A role that syncs a bucket or writes
  to a Vault needs the login's environment, not a secret. With
  `environment: "{{ local_env_logins[name].env }}"`, the task is the same for
  AWS and Vault.
- **local-env names the AWS profile.** The source does not know the profiles of
  the user or of the other sources. A name that a source picks can be the name
  of another account in another source: its roles then read the secrets of the
  wrong account. `local-env-<source>-<login>` cannot clash, because the source
  name is unique, and it is the same on every Mac. Two sources that declare the
  same account get two profiles, but one sso-session: one login.
- **One sso-session for each Identity Center.** The SSO token belongs to the
  session, not to the profile. Profiles that share it need one browser login.
- **A clash of login names stops the install.** Extra vars are global. Picking
  one of the two would give a role the account of another source. The role names
  the source to fix it.
- **Log in before the playbook, not in it.** Without a session, the CLI fails at
  once (`Token for acme does not exist`, exit 255), and `no_log` hides the
  message. A login task in a role would stop the run in the middle, after other
  roles ran, and open a browser from the dashboard. Before the playbook, the
  user answers everything at the start and the run goes on alone.
- **local-env installs and configures the CLI.** Else, the first install cannot
  check a session: the role that installs the CLI and writes the profile runs in
  the playbook, after the check.
- **local-env writes `~/.aws/config` itself.** `aws configure set` cannot write
  an `[sso-session]` section: it writes the keys into `[default]`. The
  `sso-session` format refreshes the token without a new login, the old profile
  keys do not.
- **The dashboard never logs in.** It runs in a container. A login opens a
  browser or asks for a password: it belongs to a terminal on the Mac.

## Limits

- Only `registry`, `aws` and `vault`. A new type is a new file in
  `apps/cli/src/logins/` and a line in its list.
- Templates cannot use a secret of a vault yet (`${NAME}` filled from AWS or
  Vault): the references are ready for it. Only roles read secrets. A registry
  token cannot come from a vault yet.
- A role that uses the lookup runs only with local-env: without it, the
  collection `local_env.core` is not there. A role that uses `local_env_logins`
  can give a default (`| default({'AWS_PROFILE': 'acme'})`).
- The lookup reads a secret each time a task uses it: a role that uses one
  secret in five tasks reads it five times. `set_fact` with `no_log` keeps it
  for the run.
- The e2e tests fake `ansible-playbook`:
  `tests/unit/ansible/secret-lookup.test.ts` runs the lookup with the real
  Ansible, and skips where Ansible is not installed (CI).
- Two roles of one install that name the same login without its source must find
  the same login.
- The Vault CLI keeps one token, in `~/.vault-token`. Two Vault servers log each
  other out: the status of the other one is `logged-out`, and the next install
  logs in again. A token helper by address would fix it.
- The `vault` type supports static reads only. Dynamic secrets (leases) are not
  renewed.
- local-env checks the session at the start of the install. A session that ends
  during the run makes the role fail; the next install logs in again.
- A renamed login or source gives a new profile name. The user's own
  `aws --profile` commands must use the new name.
- On the first install from the dashboard, the CLI installs, but the login stops
  the run: the user logs in in a terminal, then installs again.
- The install dialog does not list the logins that the next install needs: the
  install says it, and stops before anything runs.
