Certificates for `*.local-env-e2e.test`, the domain of the e2e tests. Test keys
only, never trusted anywhere.

- `valid.*`: valid until 2126
- `expired.*`: expired on 2021-01-01

Recreate one with OpenSSL 3.4 or later:

```sh
D=local-env-e2e.test
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
  -days 36500 -subj "/CN=$D" -addext "subjectAltName=DNS:$D,DNS:*.$D" \
  -keyout valid.key -out valid.crt
```

For `expired.*`, replace `-days 36500` with
`-not_before 20200101000000Z -not_after 20210101000000Z`.
