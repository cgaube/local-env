# local_env.core

What local-env gives to the roles it runs. local-env links it into every
`local-env install`: a role uses it without declaring it.

- `lookup('local_env.core.secret', '<name>')`: a secret that the role declares
  in the `secrets:` of its `local-env.yml`, read from the company's vault with
  the vendor's CLI and your own session.
