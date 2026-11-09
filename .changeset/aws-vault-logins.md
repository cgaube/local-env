---
'local-env': minor
---

Tools can read secrets from AWS Secrets Manager and HashiCorp Vault. A source
declares the account in the `logins` of its manifest (`type: aws` or
`type: vault`). A role declares the secrets it reads in its `local-env.yml`
(`secrets: { github_token: { login: acme-dev, ref: platform/dev/github, field: token } }`),
and a task reads one with `lookup('local_env.core.secret', 'github_token')`.
Before the playbook, `local-env install` checks every secret, installs the CLI,
writes the AWS profile, checks that you are logged in and offers to log in. The
lookup reads the secret with the vendor's CLI and your own session: local-env
keeps no secret. A role that runs the CLI itself names the login
(`logins: [acme-dev]`) and gets its environment in `local_env_logins`.
`local-env sources list`, `login`, `logout` and `doctor` show and manage these
logins too.
