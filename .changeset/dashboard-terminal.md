---
'local-env': minor
---

Install and update from the dashboard. Install is in the header of the Tools and
Profiles pages, and turns primary with a count when changes wait; Update is in
the version menu of the sidebar. Each opens a terminal in the page and runs the
command on your Mac, where you answer its questions and type the sudo password.
`local-env start` starts the dashboard agent that runs them, and
`local-env stop` stops it. The core services no longer restart on their own:
after a restart of your Mac, run `local-env start`.
