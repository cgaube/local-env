# Bootstrap the logins

Your logins can need something on the Mac before they work: a CLI, an AWS
profile, a VPN client. A role can set it up, but the install reads the secrets
of the tools before it runs any role. On a new Mac, the login fails before the
role that would fix it can run.

The `bootstrap` of the manifest fixes this. It lists the roles that make the Mac
ready for your logins, and local-env runs them first:

1. **Bootstrap**: the roles of `bootstrap`.
2. **Logins**: the AWS and Vault sessions, the registry logins, the ECR tokens.
3. **Install**: the profile and the tools, then their stacks.

```yaml
# local-env.yml
name: acme
bootstrap:
  - acme.platform.aws_access
logins:
  acme-dev:
    type: aws
    profile: acme-dev # written by acme.platform.aws_access
    help: Run `local-env sources bootstrap acme`, then `local-env login`
```

Name each role as a dependency names it: `<namespace>.<collection>.<role>`, or
the name of a plain role. local-env looks in your source first, then in the
other sources.

## The rules

A bootstrap runs before the logins, so it can't use them. A bootstrap role, and
each of its dependencies:

- gets no secret: no input that the `secrets` of the manifest names, no
  `secrets:` in its `local-env.yml`;
- names no login (`logins:` in its `local-env.yml`);
- needs no stack (`stacks:` in its `local-env.yml`).

`local-env sources add` refuses a source that breaks a rule, and
`local-env doctor` reports it. Inputs that are not secrets are fine: they are
asked and saved like the inputs of the tools.

## When it runs

local-env keeps a hash of the bootstrap roles, their dependencies and the values
of their inputs, like it does for tools. The bootstrap runs when it never ran,
or when that hash changed:

- `local-env sources add` asks: "acme has a bootstrap (AWS access). Run it now?"
- `local-env install` and `local-env login` run it first, without a question.
- `local-env onboard` runs it after `start`, then the logins, then the install.
- `local-env sources sync` and `local-env update` ask when it changed.
- `local-env sources bootstrap [source]` runs it, even when it is done.

`local-env start` never runs it.

The dashboard doesn't list bootstrap roles on the Tools page: they are not a
choice. The Overview shows the bootstrap in the panel of its source.

## Example: Granted and a stable AWS profile

Your company signs in to AWS with [Granted](https://granted.dev). The aws login
of the source names one profile, `acme-dev`, on every Mac. A bootstrap role
installs Granted and writes that profile, with the AWS role of each user:

```
ansible/platform/roles/aws_access/
├── meta/main.yml
├── meta/argument_specs.yml
├── local-env.yml          # label: AWS access
└── tasks/main.yml
```

```yaml
# meta/argument_specs.yml: the AWS role is asked once, then saved
argument_specs:
  main:
    options:
      aws_role_name:
        type: str
        required: true
        description: Your AWS role in the dev account (DevReadOnly, DevAdmin…)
```

```yaml
# tasks/main.yml
- name: Install Granted
  ansible.builtin.command: brew install common-fate/granted/granted
  args:
    creates: /opt/homebrew/bin/granted

- name: Write the profile acme-dev
  ansible.builtin.blockinfile:
    path: ~/.aws/config
    create: true
    mode: '0600'
    marker: '# {mark} acme-dev, written by local-env (acme)'
    block: |
      [profile acme-dev]
      granted_sso_start_url = https://acme.awsapps.com/start
      granted_sso_region = eu-west-1
      granted_sso_account_id = 123456789012
      granted_sso_role_name = {{ aws_role_name }}
      credential_process = granted credential-process --profile acme-dev
      region = eu-west-1
```

- The profile name is the alias: `acme-dev` on every Mac, whatever the role of
  the user. The `aws` login names it with `profile:`, and the secrets and ECR
  tokens of the source go through it.
- `blockinfile` keeps the rest of `~/.aws/config` as it is, and the block is
  written again when the role runs again.
- Check the keys against the Granted documentation for your version.

## Try it

Add your source, then run the bootstrap and the logins:

```sh
local-env sources add <repo>
local-env sources bootstrap
local-env login
```

`local-env doctor` shows whether the bootstrap ran with its roles as they are
now.

[How the bootstrap works](../3-how-it-works/source-bootstrap.md).
