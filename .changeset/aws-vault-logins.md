---
'local-env': minor
---

Tools can read secrets from AWS Secrets Manager and HashiCorp Vault. A source
declares the account in the `logins` of its manifest (`type: aws` or
`type: vault`), and a role names it in its `local-env.yml`
(`logins: [acme-dev]`). Before the playbook, `local-env install` installs the
CLI, writes the AWS profile, checks that you are logged in and offers to log in,
then gives the role the account's environment in `local_env_logins`. local-env
never sees a secret. `local-env sources list`, `login`, `logout` and `doctor`
show and manage these logins too.
