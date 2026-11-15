# local-env's stdout callback: one JSON object a line, for each event that
# playbook-output.ts draws, with only the fields it reads. local-env writes
# this file into the run folder and points ANSIBLE_CALLBACK_PLUGINS at it, so
# a run needs no collection for its output: ansible-core is enough.
# Standard library and ansible.plugins.callback only (Python 3.10+).

import json
import sys

from ansible.plugins.callback import CallbackBase

DOCUMENTATION = """
name: local_env
type: stdout
short_description: Ansible events as JSON lines, for local-env
description:
  - One JSON object a line, for each task start and each host result.
"""

# What playbook-output.ts reads of a host's result, and of each item of a
# loop
HOST_FIELDS = ("changed", "msg", "stderr")
ITEM_FIELDS = (
    "item",
    "_ansible_item_label",
    "changed",
    "failed",
    "skipped",
    "skip_reason",
    "exception",
    "msg",
    "stderr",
)


def _pick(values, fields):
    return {field: values[field] for field in fields if field in values}


def _attribute(result, name):
    # ansible-core 2.19 added `result`, `host` and `task`; older ones only
    # have the underscored names, which 2.23 deprecates
    value = getattr(result, name, None)
    return value if value is not None else getattr(result, "_" + name)


class CallbackModule(CallbackBase):
    CALLBACK_VERSION = 2.0
    CALLBACK_TYPE = "stdout"
    CALLBACK_NAME = "local_env"

    def _emit(self, event):
        # Values Ansible wraps (tagged strings, dicts) serialize as their
        # base type; anything else as its text
        sys.stdout.write(json.dumps(event, default=str) + "\n")
        sys.stdout.flush()

    def _task_start(self, event, task):
        self._emit({"_event": event, "task": {"name": task.get_name()}})

    def _host_result(self, event, result):
        values = _attribute(result, "result")
        host = _pick(values, HOST_FIELDS)
        if isinstance(values.get("results"), list):
            host["results"] = [
                _pick(item, ITEM_FIELDS)
                for item in values["results"]
                if isinstance(item, dict)
            ]
        self._emit(
            {
                "_event": event,
                "task": {"name": _attribute(result, "task").get_name()},
                "hosts": {_attribute(result, "host").get_name(): host},
            }
        )

    def v2_playbook_on_task_start(self, task, is_conditional):
        self._task_start("v2_playbook_on_task_start", task)

    def v2_playbook_on_handler_task_start(self, task):
        self._task_start("v2_playbook_on_handler_task_start", task)

    def v2_runner_on_ok(self, result):
        self._host_result("v2_runner_on_ok", result)

    def v2_runner_on_skipped(self, result):
        self._host_result("v2_runner_on_skipped", result)

    def v2_runner_on_failed(self, result, ignore_errors=False):
        self._host_result("v2_runner_on_failed", result)

    def v2_runner_on_unreachable(self, result):
        self._host_result("v2_runner_on_unreachable", result)
