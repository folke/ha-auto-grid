"""Optional compiler integration check using Jinja's sandbox, not a live HA server."""
import ast
from datetime import datetime
import json
import math
import re
import sys
from types import SimpleNamespace

from jinja2 import StrictUndefined
from jinja2.sandbox import ImmutableSandboxedEnvironment


class States:
    def __init__(self, states):
        self.values = {
            key: SimpleNamespace(
                entity_id=key,
                state=value["state"],
                name=value.get("name", key),
                attributes=value.get("attributes", {}),
                last_changed=value.get("last_changed", "2026-01-01T00:00:00+00:00"),
                last_updated=value.get("last_updated", "2026-01-01T00:00:00+00:00"),
            )
            for key, value in states.items()
        }

    def __iter__(self):
        return iter(self.values.values())

    def __call__(self, entity):
        state = self.values.get(entity)
        return state.state if state else "unknown"

    def __getitem__(self, key):
        if "." in key:
            return self.values.get(key)
        return [value for value in self.values.values() if value.entity_id.startswith(key + ".")]

    def __getattr__(self, key):
        return self[key]


def is_number(value):
    try:
        return math.isfinite(float(value))
    except (TypeError, ValueError):
        return False


payload = json.load(sys.stdin)
output = []
for case in payload:
    states = States(case["states"])
    calls = {}
    env = ImmutableSandboxedEnvironment(undefined=StrictUndefined)
    env.tests["search"] = lambda value, pattern: re.search(pattern, value) is not None
    env.globals.update(
        states=states,
        state_attr=lambda entity, attribute: states.values[entity].attributes.get(attribute),
        is_number=is_number,
        as_timestamp=lambda value: datetime.fromisoformat(value).timestamp(),
    )
    for kind in ["area", "floor", "device", "label"]:
        def entities(value, kind=kind):
            key = kind + ":" + value
            calls[key] = calls.get(key, 0) + 1
            return case.get("memberships", {}).get(key, [])
        env.globals[kind + "_entities"] = entities
    result = env.from_string(case["template"]).render()
    output.append({"result": ast.literal_eval(result.strip()), "calls": calls})
json.dump(output, sys.stdout)
