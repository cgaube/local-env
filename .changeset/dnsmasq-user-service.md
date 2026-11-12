---
'local-env': patch
---

dnsmasq runs as your own Homebrew service, started at login, not as root.
`local-env setup` asks for your password only to write `/etc/resolver`, and
`brew uninstall local-env` no longer fails with "Could not remove dnsmasq keg".
If an older setup left dnsmasq running as root, stop it once with
`sudo brew services stop dnsmasq`, then run `local-env setup`.
