---
'local-env': minor
---

Tools can get secrets from AWS Secrets Manager and HashiCorp Vault. A source
declares the account in the `logins` of its manifest (`type: aws` or
`type: vault`), and where each secret is in its `secrets`, by the name of the
variable it fills
(`secrets: { github_token: { login: acme-dev, ref: platform/dev/github, field: token } }`).
A role of the source that declares that input in `meta/argument_specs.yml`
(usually `no_log`), or asks for it in its `local-env.yml`, gets it as a plain
variable, `{{ github_token }}`. Before the playbook, `local-env install` checks
the secrets, installs the CLI, writes the AWS profile, checks that you are
logged in and offers to log in, then reads only the secrets of the tools it
runs, with the vendor's CLI and your own session. Their values reach Ansible
through a named pipe, never the disk: local-env keeps no secret. The Variables
form shows those inputs as "From the vault". A role that runs the CLI itself
names the login (`logins: [acme-dev]`) and gets its environment in
`local_env.logins`. `local-env sources list`, `login`, `logout` and `doctor`
show and manage these logins too.
