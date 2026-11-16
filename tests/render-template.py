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
    def entity_name(entity, *, fallback=False):
        entry = case.get("registry", {}).get(entity)
        if entry is not None:
            name = entry.get("entity_name")
            if not name and fallback and entry.get("next_name_part") == "device":
                device = case.get("devices", {}).get(entry.get("device_id"))
                if device is not None:
                    return device.get("name_by_user") or device.get("name")
            return name
        state = states.values.get(entity)
        return state.name if state else None

    def entity_device(entity):
        entry = case.get("registry", {}).get(entity, {})
        return case.get("devices", {}).get(entry.get("device_id"), {})

    def entity_area(entity):
        entry = case.get("registry", {}).get(entity, {})
        area_id = entry.get("area_id") or entity_device(entity).get("area_id")
        return case.get("areas", {}).get(area_id, {})

    def config_entry_attr(entry_id, attribute):
        if not isinstance(entry_id, str):
            raise ValueError("Must provide a config entry ID")
        return case.get("config_entries", {}).get(entry_id, {}).get(attribute)

    def label_name(label):
        return case.get("labels", {}).get(label, {}).get("name")

    env.filters["label_name"] = label_name
    env.globals.update(
        entity_name=entity_name,
        area_name=lambda entity: entity_area(entity).get("name"),
        floor_name=lambda entity: case.get("floors", {}).get(entity_area(entity).get("floor_id"), {}).get("name"),
        device_name=lambda entity: entity_device(entity).get("name_by_user") or entity_device(entity).get("name"),
        labels=lambda entity: case.get("registry", {}).get(entity, {}).get("labels", []),
        config_entry_id=lambda entity: case.get("registry", {}).get(entity, {}).get("config_entry_id"),
        config_entry_attr=config_entry_attr,
        states=states,
        state_attr=lambda entity, attribute: states.values[entity].attributes.get(attribute),
        is_number=is_number,
        is_hidden_entity=lambda entity: case.get("registry", {}).get(entity, {}).get("hidden_by") is not None,
        as_timestamp=lambda value: datetime.fromisoformat(value).timestamp(),
    )
    for kind in ["area", "floor", "device", "label", "integration"]:
        def entities(value, kind=kind):
            key = kind + ":" + value
            calls[key] = calls.get(key, 0) + 1
            return case.get("memberships", {}).get(key, [])
        env.globals[kind + "_entities"] = entities
    result = env.from_string(case["template"]).render()
    output.append({"result": ast.literal_eval(result.strip()), "calls": calls})
json.dump(output, sys.stdout)
