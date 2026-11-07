---
'local-env': minor
---

Tools can now ask for values: their variables. A role declares them in
`meta/argument_specs.yml`, the standard file of Ansible. The Tools and Profiles
pages of the dashboard have a Variables button beside Install: one form with the
variables of every tool you install, a field for each, in panels by role. A
value that your profile sets is shown, and it wins. Values you no longer use
stay saved in a Saved tab. The Variables button says when a required value is
missing. `local-env install` asks in the terminal for a required value that has
no value and no default, saves the answer and gives the values to Ansible. A
changed value shows the tools that use it as "Update available". The install
output shows a line for each item of a loop. `local-env vars` lists the
variables of your tools, `local-env vars set` and `unset` change them.
`local-env install --dry-run` shows what the install runs and the state of each
input. local-env does not support secrets (`no_log: true`) yet: an install that
needs one stops and names it.
