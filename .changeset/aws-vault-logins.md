---
'local-env': minor
---

Tools can get secrets from AWS Secrets Manager and HashiCorp Vault. A source
declares its `aws` and `vault` logins and its `secrets` in its manifest, and
`local-env install` logs you in, then gives each role the secrets it declares as
inputs, without writing them to the disk.
