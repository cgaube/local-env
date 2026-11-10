# Tool secrets

local-env keeps no secret. Your source says where each secret is, in your
company's secret manager; local-env reads it with the manager's CLI and the
user's own session, and gives it to the tools that need it. local-env supports
AWS Secrets Manager and HashiCorp Vault.

1. Declare the login and the secrets in the manifest of the source. A secret is
   named after the variable it fills:

   ```yaml
   # local-env.yml
   name: acme-platform
   logins:
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
   secrets:
     github_token:
       login: acme-dev
       ref: platform/dev/github # the secret id in AWS Secrets Manager
       field: token # a key of its JSON value
     npm_token:
       login: data-vault
       ref: secret/npm # the path of the KV entry
       field: token # its key: required for Vault
   ```

2. Declare the input in the role, as Ansible does: in `meta/argument_specs.yml`,
   usually with `no_log: true`. Its tasks use it as any variable:

   ```yaml
   # ansible/dev_tools/roles/github/meta/argument_specs.yml
   argument_specs:
     main:
       options:
         github_token:
           type: str
           required: true
           no_log: true
           description: A token to read the repos of Acme
   ```

   ```yaml
   - name: Save the GitHub token
     ansible.builtin.command: gh auth login --with-token
     args:
       stdin: '{{ github_token }}'
     no_log: true
   ```

   A role without an `argument_specs.yml` asks for the secret in its
   `local-env.yml` instead: `secrets: [npm_token]`.

Before the playbook, `local-env install` installs the CLI (`awscli`, or `vault`
from `hashicorp/tap`), writes the AWS profile, and checks the session. If the
user is not logged in, it offers to log in (`aws sso login`, `vault login`) and
gives the terminal to the CLI. From the dashboard, it stops and shows the
command to run in a terminal. Then it reads the secrets, and gives them to
Ansible. Your role does not install the CLI, does not log in, does not read the
vault, and stays plain Ansible: without local-env, pass `-e github_token=…`
yourself.

## The secrets

- A secret is named after the variable it fills: letters, digits and `_`, as
  Ansible wants. `local_env…` and `ansible_…` are local-env's and Ansible's own.
  A Docker stack will use the same rule, with the variable of its compose file
  (`DB_PASSWORD`).
- A role gets the secrets of **its own source**: the inputs of its
  `argument_specs.yml` that the `secrets` of the manifest name, and the names
  its `local-env.yml` asks for. A role of another source that declares
  `github_token` does not get yours.
- `login` can be a login of another source (`platform/acme-dev`), as a company
  source can declare the logins of every team. It must be an `aws` or a `vault`
  login.
- AWS: `ref` is the secret's name or ARN. Without `field`, you get the secret's
  text as it is; with `field`, a key of its JSON value.
- Vault: `ref` is the path of a KV entry (`secret/npm`), and `field` is
  required: the key to read. KV v1 and v2 both work.
- local-env reads a secret only when a tool that this install runs needs it,
  once, before the playbook. A secret that no tool of the install needs is never
  read.
- `local-env sources add` refuses a manifest whose secrets are not valid.
  `local-env install` stops before anything runs on a secret that it cannot get:
  a role asks for a name that its source does not declare, a login is missing,
  the CLI cannot read it (no access, a wrong `ref` or `field`). It shows the
  error of the CLI.
- A value from the vault wins over a value saved in Variables. A value that a
  profile gives to one of its tools (`vars:` of its dependencies) wins over the
  vault: local-env does not read the secret then.
- The Variables form of the dashboard shows an input that the vault gives as
  **From the vault**, without its value. `local-env vars set` refuses it.
- The values reach Ansible through a named pipe: they are never written to the
  disk. Ansible never templates them: a secret can hold `{{`. local-env does not
  record them: a new value in the vault does not mark the tool as changed.
- Ansible's variables are global: if two sources give `github_token` from two
  different secrets, and one install runs a role of each, the install stops.
  Rename it in one of the sources.
- `no_log: true` keeps the value out of the output. A task that uses it without
  `no_log` can print the secret, as with any variable.
- Don't use Ansible's own lookups (`amazon.aws.secretsmanager_secret`,
  `community.hashi_vault`): they need Python packages (`boto3`, `hvac`) that the
  Ansible of local-env does not have.

## Run the CLI yourself

A role that does more than read a secret (`aws s3 sync`, `vault write`) names
the login in `logins:` and runs the CLI with the login's environment, which
local-env gives in the extra var `local_env.logins`:

```yaml
# ansible/dev_tools/roles/fixtures/local-env.yml
logins: [acme-dev]
```

```yaml
- name: Download the fixtures
  ansible.builtin.command: aws s3 sync s3://acme-dev-fixtures ~/fixtures
  environment: "{{ local_env.logins['acme-dev'].env }}"
```

- `local_env.logins['acme-dev']` also has `profile` and `region` (AWS), or
  `address` and `namespace` (Vault).
- Extra vars are global: if two roles of one install name `acme-dev` and it is
  another login for each (two sources declare it), the install stops. Name the
  source: `logins: [acme-platform/acme-dev]`.

## The AWS profile

- local-env writes the profile `local-env-<source>-<login>` in `~/.aws/config`
  (`local-env-acme-platform-acme-dev`), with one `sso-session` for each start
  URL: one browser login covers all the accounts of an Identity Center. It never
  changes a profile that the user wrote.
- Without `sso`, give `profile:`, the name of a profile that the user set up
  (`credential_process`, aws-vault). local-env writes nothing.
- `method` is the auth method of `vault login`, `oidc` by default. `mount` sets
  the path of the method when it is not the default one.
