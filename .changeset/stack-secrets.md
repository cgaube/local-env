---
'local-env': minor
---

Docker templates can get secrets from AWS Secrets Manager and HashiCorp Vault:
the source's manifest maps a compose variable to a secret, and local-env saves
the value in Dockhand as a secret variable when it deploys or syncs the stack.
