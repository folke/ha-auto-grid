import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { normalizeConfig } from "../src/query.ts"

const compileFilter = (include, sort, limit) =>
  normalizeConfig({ include, sort: sort ?? [], limit }).query.template

const python = spawnSync("python3", ["-c", "import jinja2"], { encoding: "utf8" })
test(
  "compiled queries execute correctly in a sandboxed Jinja environment",
  {
    skip: python.status !== 0 ? "Optional check requires Python 3 with jinja2 installed" : false,
  },
  () => {
    const states = {
      "light.pool": { state: "on", name: "Pool" },
      "light.hall": { state: "off", name: "Hall" },
      "light.deck": { state: "on", name: "Deck" },
      "sensor.low": { state: "12", name: "Low", attributes: { battery: 12, present: true } },
      "sensor.high": { state: "80", name: "High", attributes: { battery: 80, present: false } },
      "sensor.missing": { state: "unavailable", name: "Missing" },
      "sensor.weird": { state: `a') }} {{ states`, name: "Weird" },
    }
    const memberships = {
      "area:pool": ["light.pool", "light.deck", "sensor.low", "light.disabled"],
      "label:outside": ["light.deck"],
      "device:device_id": ["sensor.low", "sensor.high"],
      "floor:ground": ["light.hall", "light.pool"],
    }
    const cases = [
      [{ area: "pool", domain: "light" }, { by: "name" }, undefined, ["light.deck", "light.pool"]],
      [
        { area: "pool", domain: "light", state: "on" },
        undefined,
        undefined,
        ["light.pool", "light.deck"],
      ],
      [
        { domain: "light", any: [{ state: "off" }, { label: "outside" }] },
        undefined,
        undefined,
        ["light.hall", "light.deck"],
      ],
      [
        { all: [{ area: "pool" }, { not: { domain: "sensor" } }] },
        undefined,
        undefined,
        ["light.pool", "light.deck"],
      ],
      [
        { any: [{ domain: "light" }, { device: "device_id" }] },
        undefined,
        4,
        ["light.pool", "light.hall", "light.deck", "sensor.low"],
      ],
      [{ not: { domain: "light" } }, undefined, 2, ["sensor.low", "sensor.high"]],
      [{ domain: "sensor", state: "<20" }, undefined, undefined, ["sensor.low"]],
      [
        { domain: "sensor", attributes: { battery: ">= 80" } },
        undefined,
        undefined,
        ["sensor.high"],
      ],
      [{ domain: "sensor", attributes: { present: true } }, undefined, undefined, ["sensor.low"]],
      [
        { entity_id: "light.*", name: "/^[DP]/" },
        undefined,
        undefined,
        ["light.pool", "light.deck"],
      ],
      [{ entity_id: "light.*", name: "P*" }, undefined, undefined, ["light.pool"]],
      [{ domain: "sensor", state: `a') }} {{ states` }, undefined, undefined, ["sensor.weird"]],
      [
        { domain: "sensor" },
        { by: "state", numeric: true, reverse: true },
        undefined,
        ["sensor.high", "sensor.low", "sensor.missing", "sensor.weird"],
      ],
      [{ domain: "light" }, { by: "name", reverse: true }, 2, ["light.pool", "light.hall"]],
      [{ floor: "ground" }, undefined, undefined, ["light.hall", "light.pool"]],
      [
        { entity_id: ["light.pool", "light.pool", "light.disabled"] },
        undefined,
        undefined,
        ["light.pool"],
      ],
      [
        { domain: ["light", "sensor"], state: ["on", 12] },
        undefined,
        undefined,
        ["light.pool", "light.deck", "sensor.low"],
      ],
      [{ domain: "light" }, undefined, 0, []],
      [{ any: [] }, undefined, undefined, []],
      [
        { domain: "light", all: [] },
        undefined,
        undefined,
        ["light.pool", "light.hall", "light.deck"],
      ],
      [{ domain: "light", name: "P.*" }, undefined, undefined, []],
      [
        { entity_id: "sensor.low", attributes: { absent: null } },
        undefined,
        undefined,
        ["sensor.low"],
      ],
      [
        { device: "device_id" },
        { by: "attribute", attribute: "battery", numeric: true },
        undefined,
        ["sensor.low", "sensor.high"],
      ],
      [
        { domain: "light" },
        { by: "last_updated" },
        undefined,
        ["light.deck", "light.hall", "light.pool"],
      ],
    ]
    const payload = cases.map(([filter, sort, limit]) => ({
      template: compileFilter(filter, sort, limit),
      states,
      memberships,
    }))
    const result = spawnSync(
      "python3",
      [fileURLToPath(new URL("./render-template.py", import.meta.url))],
      {
        input: JSON.stringify(payload),
        encoding: "utf8",
      }
    )
    assert.equal(result.status, 0, result.stderr)
    JSON.parse(result.stdout).forEach((actual, index) => {
      assert.deepEqual(
        actual.result,
        cases[index][3].map((entity) => ({ entity, group: 0 })),
        `case ${index}: ${JSON.stringify(cases[index][0])}`
      )
      for (const calls of Object.values(actual.calls))
        assert.equal(calls, 1, "registry helpers are hoisted")
    })
  }
)

test(
  "include/exclude groups and prioritized sorts execute with agreed semantics",
  {
    skip: python.status !== 0 ? "Optional check requires Python 3 with jinja2 installed" : false,
  },
  () => {
    const states = {
      "light.z": { state: "on", name: "Same", attributes: { device_class: "light" } },
      "light.a": { state: "off", name: "same", attributes: { device_class: "light" } },
      "sensor.z": { state: "12", name: "A", attributes: { device_class: "battery" } },
      "sensor.a": { state: "3", name: "Z", attributes: { device_class: "temperature" } },
      "sensor.missing": { state: "unavailable", name: "0" },
    }
    const row = (entity, group = 0) => ({ entity, group })
    const groups = [{ domain: "light" }, { domain: "sensor" }]
    const cases = [
      [
        "default include/name, with entity-ID fallback",
        { include: groups },
        [
          row("light.a"),
          row("light.z"),
          row("sensor.missing", 1),
          row("sensor.z", 1),
          row("sensor.a", 1),
        ],
      ],
      [
        "explicit name replaces include grouping",
        { include: groups, sort: { by: "name" } },
        [
          row("sensor.missing", 1),
          row("sensor.z", 1),
          row("light.a"),
          row("light.z"),
          row("sensor.a", 1),
        ],
      ],
      [
        "empty sort preserves group and candidate order",
        { include: groups, sort: [] },
        [
          row("light.z"),
          row("light.a"),
          row("sensor.z", 1),
          row("sensor.a", 1),
          row("sensor.missing", 1),
        ],
      ],
      [
        "first matching group owns duplicates",
        { include: [{ entity_id: "light.z" }, ...groups] },
        [
          row("light.z"),
          row("light.a", 1),
          row("sensor.missing", 2),
          row("sensor.z", 2),
          row("sensor.a", 2),
        ],
      ],
      [
        "global exclusion applies to all groups",
        { include: groups, exclude: [{ state: "unavailable" }, { entity_id: "light.z" }] },
        [row("light.a"), row("sensor.z", 1), row("sensor.a", 1)],
      ],
      [
        "local NOT doesn't exclude a later group's matches",
        { include: [{ domain: "light", not: { state: "on" } }, { domain: "light" }] },
        [row("light.a"), row("light.z", 1)],
      ],
      [
        "global exclusions cannot be overridden",
        {
          include: [{ entity_id: "light.z" }, { domain: "light" }],
          exclude: { entity_id: "light.z" },
        },
        [row("light.a", 1)],
      ],
      [
        "include then numeric state, unavailable last",
        { include: groups, sort: [{ by: "include" }, { by: "state", numeric: true }] },
        [
          row("light.a"),
          row("light.z"),
          row("sensor.a", 1),
          row("sensor.z", 1),
          row("sensor.missing", 1),
        ],
      ],
      [
        "reverse numeric preserves missing-last and group priority",
        {
          include: groups,
          sort: [{ by: "include" }, { by: "state", numeric: true, reverse: true }],
        },
        [
          row("light.a"),
          row("light.z"),
          row("sensor.z", 1),
          row("sensor.a", 1),
          row("sensor.missing", 1),
        ],
      ],
      [
        "reverse include order",
        { include: groups, sort: [{ by: "include", reverse: true }, { by: "name" }] },
        [
          row("sensor.missing", 1),
          row("sensor.z", 1),
          row("sensor.a", 1),
          row("light.a"),
          row("light.z"),
        ],
      ],
      [
        "limit after global exclusion and deduplication",
        { include: [{ domain: "light" }, {}], exclude: { entity_id: "light.a" }, limit: 2 },
        [row("light.z"), row("sensor.missing", 1)],
      ],
      ["zero limit", { include: groups, limit: 0 }, []],
      ["empty include", { include: [] }, []],
      [
        "empty exclusion list",
        { include: { entity_id: "light.z" }, exclude: [] },
        [row("light.z")],
      ],
      [
        "device class shorthand",
        { include: { domain: "sensor", device_class: "battery" } },
        [row("sensor.z")],
      ],
      [
        "contradictory device class constraints are ANDed",
        {
          include: {
            domain: "sensor",
            device_class: "battery",
            attributes: { device_class: "temperature" },
          },
        },
        [],
      ],
      [
        "class list",
        { include: { domain: "sensor", device_class: ["battery", "temperature"] } },
        [row("sensor.z"), row("sensor.a")],
      ],
      [
        "global nested exclusion",
        {
          include: groups,
          exclude: { any: [{ device_class: "battery" }, { not: { domain: "sensor" } }] },
        },
        [row("sensor.missing", 1), row("sensor.a", 1)],
      ],
    ]
    const many = Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [`sensor.group_${i}`, { state: "0", name: "Same" }])
    )
    const manyIncludes = Object.keys(many).map((entity_id) => ({ entity_id }))
    const payload = cases.map(([, config]) => ({
      template: normalizeConfig(config).query.template,
      states,
    }))
    payload.push({
      template: normalizeConfig({ include: manyIncludes }).query.template,
      states: many,
    })
    const output = spawnSync(
      "python3",
      [fileURLToPath(new URL("./render-template.py", import.meta.url))],
      { input: JSON.stringify(payload), encoding: "utf8" }
    )
    assert.equal(output.status, 0, output.stderr)
    const results = JSON.parse(output.stdout)
    cases.forEach(([name, , expected], i) => assert.deepEqual(results[i].result, expected, name))
    assert.deepEqual(
      results.at(-1).result,
      Object.keys(many).map((entity, group) => row(entity, group)),
      "include sorting is numeric, not lexicographic"
    )
  }
)
