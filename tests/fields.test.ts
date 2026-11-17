import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { normalizeConfig, rendered } from "./helpers.ts"

const python = spawnSync("python3", ["-c", "import jinja2"], { encoding: "utf8" })
test(
  "shared field values filter integrations/timestamps and sort every filter field",
  {
    skip: python.status !== 0 ? "Optional check requires Python 3 with jinja2 installed" : false,
  },
  () => {
    const payload = {
      states: {
        "sensor.a": {
          state: "10",
          name: "A",
          attributes: { device_class: "battery" },
          last_changed: "2026-01-01T00:20:00+00:00",
          last_updated: "2026-01-01T00:40:00+00:00",
        },
        "sensor.b": {
          state: "2",
          name: "B",
          attributes: { device_class: "battery" },
          last_changed: "2026-01-01T00:10:00+00:00",
          last_updated: "2026-01-01T00:50:00+00:00",
        },
        "sensor.c": {
          state: "unknown",
          name: "C",
          last_changed: "2026-01-01T00:30:00+00:00",
          last_updated: "2026-01-01T00:30:00+00:00",
        },
        "sensor.d": {
          state: "3",
          name: "D",
          attributes: { device_class: "temperature" },
          last_changed: "2026-01-01T01:00:00+01:00",
          last_updated: "2026-01-01T01:00:00+00:00",
        },
      },
      registry: {
        "sensor.a": {
          entity_name: "A",
          hidden_by: "user",
          device_id: "z",
          config_entry_id: "zha_entry",
          labels: ["z", "a"],
        },
        "sensor.b": {
          entity_name: "B",
          device_id: "a",
          area_id: "office",
          config_entry_id: "mqtt_entry",
          labels: ["m"],
        },
        "sensor.d": { entity_name: "D", device_id: "z", area_id: "office", labels: ["missing"] },
      },
      devices: {
        z: { name: "Original Z", name_by_user: "Alpha", area_id: "pool" },
        a: { name: "Beta" },
      },
      areas: {
        pool: { name: "Zeta", floor_id: "upper" },
        office: { name: "Alpha", floor_id: "ground" },
      },
      floors: { upper: { name: "Upper" }, ground: { name: "Ground" } },
      labels: { a: { name: "Alpha" }, z: { name: "Zulu" }, m: { name: "Middle" } },
      config_entries: { zha_entry: { domain: "zha" }, mqtt_entry: { domain: "mqtt" } },
      memberships: {
        "integration:mqtt": ["sensor.b"],
        "integration:zha": ["sensor.a"],
        "integration:yaml_template": ["sensor.d"],
        "integration:My MQTT": ["sensor.b"],
      },
    }
    const selection = { domain: "sensor" }
    const cases: [Record<string, unknown>, string[]][] = [
      [{ include: { integration: "mqtt" } }, ["sensor.b"]],
      [{ include: { integration: ["zha", "mqtt"] } }, ["sensor.a", "sensor.b"]],
      [{ include: { integration: "My MQTT" } }, ["sensor.b"]],
      [{ include: { integration: "yaml_template" } }, ["sensor.d"]],
      [
        { include: selection, exclude: { integration: "mqtt" } },
        ["sensor.a", "sensor.c", "sensor.d"],
      ],
      [
        { include: { domain: "sensor", not: { integration: "zha" } } },
        ["sensor.b", "sensor.c", "sensor.d"],
      ],
      [
        { include: { any: [{ integration: "mqtt" }, { integration: "yaml_template" }] } },
        ["sensor.b", "sensor.d"],
      ],
      [{ include: { last_changed: ">= 1767226800" } }, ["sensor.a", "sensor.c"]],
      [{ include: { last_changed: 1767225600 } }, ["sensor.d"]],
      [{ include: { last_changed: [1767225600, 1767226200] } }, ["sensor.b", "sensor.d"]],
      [{ include: { last_updated: "<1767228300" } }, ["sensor.a", "sensor.c"]],
      [{ include: selection, exclude: { last_updated: ">1767228300" } }, ["sensor.a", "sensor.c"]],
      [
        { include: selection, sort: "last_changed" },
        ["sensor.d", "sensor.b", "sensor.a", "sensor.c"],
      ],
      [
        { include: selection, sort: { by: "last_updated", reverse: true } },
        ["sensor.d", "sensor.b", "sensor.a", "sensor.c"],
      ],
      [{ include: selection, sort: "area" }, ["sensor.c", "sensor.b", "sensor.d", "sensor.a"]],
      [{ include: selection, sort: "floor" }, ["sensor.c", "sensor.b", "sensor.d", "sensor.a"]],
      [{ include: selection, sort: "device" }, ["sensor.c", "sensor.a", "sensor.d", "sensor.b"]],
      [{ include: selection, sort: "label" }, ["sensor.c", "sensor.d", "sensor.a", "sensor.b"]],
      [{ include: selection, sort: "domain" }, ["sensor.a", "sensor.b", "sensor.c", "sensor.d"]],
      [
        { include: selection, sort: "attr.device_class" },
        ["sensor.c", "sensor.a", "sensor.b", "sensor.d"],
      ],
      [{ include: selection, sort: "hidden" }, ["sensor.b", "sensor.c", "sensor.d", "sensor.a"]],
      [
        { include: selection, sort: { by: "hidden", reverse: true } },
        ["sensor.a", "sensor.b", "sensor.c", "sensor.d"],
      ],
      [
        { include: selection, sort: "integration" },
        ["sensor.c", "sensor.d", "sensor.b", "sensor.a"],
      ],
      [
        { include: selection, sort: ["integration", { by: "state", numeric: true }] },
        ["sensor.d", "sensor.c", "sensor.b", "sensor.a"],
      ],
      [
        { include: selection, sort: { reverse: true } },
        ["sensor.d", "sensor.c", "sensor.b", "sensor.a"],
      ],
    ]
    const output = spawnSync(
      "python3",
      [fileURLToPath(new URL("./render-template.py", import.meta.url))],
      {
        input: JSON.stringify(
          cases.map(([config]) => ({
            ...payload,
            template: normalizeConfig(config).query.template,
          }))
        ),
        encoding: "utf8",
      }
    )
    assert.equal(output.status, 0, output.stderr)
    rendered(output.stdout).forEach((actual, i) => {
      assert.deepEqual(
        actual.result.map(({ entity }) => entity),
        cases[i][1],
        JSON.stringify(cases[i][0])
      )
      for (const calls of Object.values(actual.calls))
        assert.equal(calls, 1, "membership helpers remain hoisted")
    })
  }
)
