# Tool secrets

local-env keeps no secret. A tool reads its secrets from your company's secret
manager, with the manager's CLI, and local-env makes sure that the user is
logged in before the install starts. local-env supports AWS Secrets Manager and
HashiCorp Vault.

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

2. Name it in the `local-env.yml` of each role that reads a secret:

   ```yaml
   # ansible/dev_tools/roles/github/local-env.yml
   logins: [acme-dev]
   ```

3. Read the secret with the CLI, in a task with `no_log: true`. local-env gives
   each login's environment in the extra var `local_env_logins`: the task needs
   no profile name, no address and no namespace.

   ```yaml
   - name: Read the GitHub token
     ansible.builtin.command: >
       aws secretsmanager get-secret-value --secret-id platform/dev/github
       --query SecretString --output text
     environment: "{{ local_env_logins['acme-dev'].env }}"
     register: github_token
     changed_when: false
     no_log: true
   ```

   For Vault, the same `environment:` with
   `vault kv get -field=token secret/github`.

Before the playbook, `local-env install` installs the CLI (`awscli`, or `vault`
from `hashicorp/tap`), writes the AWS profile, and checks the session. If the
user is not logged in, it offers to log in (`aws sso login`, `vault login`) and
gives the terminal to the CLI. From the dashboard, it stops and shows the
command to run in a terminal. Your role does not install the CLI and does not
log in.

- local-env writes the profile `local-env-<source>-<login>` in `~/.aws/config`
  (`local-env-acme-platform-acme-dev`), with one `sso-session` for each start
  URL: one browser login covers all the accounts of an Identity Center. It never
  changes a profile that the user wrote.
- Without `sso`, give `profile:`, the name of a profile that the user set up
  (`credential_process`, aws-vault). local-env writes nothing.
- `method` is the auth method of `vault login`, `oidc` by default. `mount` sets
  the path of the method when it is not the default one.
- `logins: [acme-dev]` finds the login in the role's own source first, then in
  any source: a company source can declare the logins once for all the teams.
  `logins: [acme-platform/acme-dev]` names the source. If two sources declare
  `acme-dev` and one install needs both, it stops: name the source.
- `local_env_logins` exists only in a run of local-env. To run the role without
  it, give a default:
  `"{{ local_env_logins['acme-dev'].env | default({'AWS_PROFILE': 'acme'}) }}"`.
- Use the CLI, not Ansible lookups (`amazon.aws.secretsmanager_secret`,
  `community.hashi_vault`). The lookups need Python packages (`boto3`, `hvac`)
  that the Ansible of local-env does not have.
