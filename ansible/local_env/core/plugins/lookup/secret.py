# A secret that the role declares in the `secrets:` of its local-env.yml,
# read from the company's vault with the vendor's CLI (aws, vault) and the
# user's own session, which local-env checked before the playbook.
#
# local-env gives each role its secrets in the extra var local_env_secrets,
# by the role's full name (ansible_role_name), then by secret name: the
# command that reads it, its environment, and the keys to take from its JSON
# output (apps/cli/src/logins/wanted.ts). No secret is in the extra vars:
# this plugin reads them when a task uses them. The provider's logic stays in
# local-env (aws.ts, vault.ts): this file only runs what it is given.
#
# docs/2-write-a-source/5-secrets.md explains it to the authors of roles.

from __future__ import annotations

DOCUMENTATION = r"""
name: secret
author: local-env
short_description: A secret of the role, read from the company's vault
description:
  - Reads a secret that the role declares in the C(secrets) of its
    C(local-env.yml), with the vendor's CLI and the user's own session.
  - Only in a run of C(local-env install), which declares the secrets.
options:
  _terms:
    description: The names of the secrets, as the role declares them.
    required: true
"""

EXAMPLES = r"""
- name: Write the Stripe key
  ansible.builtin.copy:
    dest: ~/.config/billing/credentials
    content: "stripe_key = {{ lookup('local_env.core.secret', 'stripe_key') }}"
    mode: "0600"
  no_log: true
"""

RETURN = r"""
_raw:
  description: The value of each secret, as text.
  type: list
  elements: str
"""

import json
import os
import subprocess

from ansible.errors import AnsibleError
from ansible.plugins.lookup import LookupBase
from ansible.utils.unsafe_proxy import wrap_var


def _read(role, name, spec):
    where = f"{role}: the secret {name} ({spec.get('title', '')})"
    env = {**os.environ, **spec.get("env", {})}
    try:
        done = subprocess.run(
            spec["argv"],
            env=env,
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
    except FileNotFoundError:
        raise AnsibleError(f"{where}: {spec['argv'][0]} is not installed")
    except subprocess.TimeoutExpired:
        raise AnsibleError(f"{where}: {spec['argv'][0]} did not answer")
    if done.returncode != 0:
        # The CLI's error says why (a session that ended, no access): it
        # holds no secret
        hint = spec.get("hint")
        raise AnsibleError(
            f"{where} could not be read: {done.stderr.strip()}"
            + (f"\n{hint}" if hint else "")
        )
    value = done.stdout.rstrip("\n")
    keys = spec.get("keys", [])
    if not keys:
        return value
    try:
        data = json.loads(value)
    except ValueError:
        raise AnsibleError(f"{where}: its value is not JSON, it has no fields")
    for key in keys:
        if not isinstance(data, dict) or key not in data:
            raise AnsibleError(f"{where} has no field {key}")
        data = data[key]
    return data if isinstance(data, str) else json.dumps(data)


class LookupModule(LookupBase):
    def run(self, terms, variables=None, **kwargs):
        variables = variables or {}
        role = variables.get("ansible_role_name")
        # Absent when no role of the run declares a secret, or outside a run
        # of local-env install
        declared = variables.get("local_env_secrets") or {}
        secrets = declared.get(role, {}) if role else {}
        values = []
        for name in terms:
            spec = secrets.get(name)
            if spec is None:
                known = ", ".join(sorted(secrets)) or "none"
                raise AnsibleError(
                    f"{role or 'This task'} declares no secret named {name} in "
                    f"the secrets: of its local-env.yml (it declares: {known}). "
                    "The lookup works in a run of local-env install."
                )
            values.append(_read(role, name, spec))
        # Never templated again: a secret can hold {{ }}
        return wrap_var(values)
