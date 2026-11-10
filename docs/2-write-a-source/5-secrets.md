# Tool secrets

local-env keeps no secret. A tool reads its secrets from your company's secret
manager, with the manager's CLI and the user's own session, and local-env makes
sure that the user is logged in before the install starts. local-env supports
AWS Secrets Manager and HashiCorp Vault.

1. Declare the login in the `logins` of the manifest:

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
   ```

2. Declare the secrets of the role in its `local-env.yml`: a name, the login,
   where the secret is, and the field to take:

   ```yaml
   # ansible/dev_tools/roles/github/local-env.yml
   secrets:
     GITHUB_TOKEN:
       login: acme-dev
       ref: platform/dev/github # the secret id in AWS Secrets Manager
       field: token # a key of its JSON value
     NPM_TOKEN:
       login: data-vault
       ref: secret/npm # the path of the KV entry
       field: token # its key: required for Vault
   ```

3. Read each one by its name, with the lookup of local-env, in a task with
   `no_log: true`:

   ```yaml
   - name: Save the GitHub token
     ansible.builtin.command: gh auth login --with-token
     args:
       stdin: "{{ lookup('local_env.core.secret', 'GITHUB_TOKEN') }}"
     no_log: true
   ```

Before the playbook, `local-env install` installs the CLI (`awscli`, or `vault`
from `hashicorp/tap`), writes the AWS profile, and checks the session. If the
user is not logged in, it offers to log in (`aws sso login`, `vault login`) and
gives the terminal to the CLI. From the dashboard, it stops and shows the
command to run in a terminal. Your role does not install the CLI, does not log
in, and does not know a profile name or an address.

## The secrets

- A name is an environment variable: uppercase letters, digits and `_`
  (`GITHUB_TOKEN`). It is the same rule for the secrets of Docker stacks, where
  compose reads it as `${GITHUB_TOKEN}`: one way to name a secret everywhere.
- `login` finds the login in the role's own source first, then in any source: a
  company source can declare the logins once for all the teams.
  `acme-platform/acme-dev` names the source.
- AWS: `ref` is the secret's name or ARN. Without `field`, you get the secret's
  text as it is; with `field`, a key of its JSON value.
- Vault: `ref` is the path of a KV entry (`secret/npm`), and `field` is
  required: the key to read. KV v1 and v2 both work.
- `local-env install` checks every secret before anything runs: a name, a login
  or a field that is not valid stops it, with the reason.
- The lookup reads the secret when the task runs, each time a task uses it. Its
  value is never written to the disk by local-env, and never templated: a secret
  can hold `{{`.
- `no_log: true` keeps the value out of the output. A task that uses the lookup
  without it can print the secret, as with any variable.
- The lookup exists only in a run of `local-env install`, which links its
  collection, `local_env.core`. Without local-env, Ansible stops on it: "The
  lookup plugin 'local_env.core.secret' was not found".
- Use local-env's lookup, not Ansible's (`amazon.aws.secretsmanager_secret`,
  `community.hashi_vault`): those need Python packages (`boto3`, `hvac`) that
  the Ansible of local-env does not have.

## Run the CLI yourself

A role that does more than read a secret (`aws s3 sync`, `vault write`) names
the login in `logins:` and runs the CLI with the login's environment, which
local-env gives in the extra var `local_env_logins`:

```yaml
# ansible/dev_tools/roles/fixtures/local-env.yml
logins: [acme-dev]
```

```yaml
- name: Download the fixtures
  ansible.builtin.command: aws s3 sync s3://acme-dev-fixtures ~/fixtures
  environment: "{{ local_env_logins['acme-dev'].env }}"
```

- `local_env_logins['acme-dev']` also has `profile` and `region` (AWS), or
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
