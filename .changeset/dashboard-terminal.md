---
'local-env': minor
---

Install and update from the dashboard. The install dialog has an Install button
and the Overview page an Update button: each opens a terminal in the page and
runs the command on your Mac, where you answer its questions and type the sudo
password. `local-env start` starts the dashboard agent that runs them, and
`local-env stop` stops it. The core services no longer restart on their own:
after a restart of your Mac, run `local-env start`.
