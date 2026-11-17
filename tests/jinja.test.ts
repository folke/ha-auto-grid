import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { normalizeConfig, rendered } from "./helpers.ts"

const compileFilter = (include: unknown, sort?: unknown, limit?: number) =>
  normalizeConfig({ include, sort: sort ?? [], limit }).query.template

const python = spawnSync("python3", ["-c", "import jinja2"], { encoding: "utf8" })
test(
  "compiled queries execute correctly in a sandboxed Jinja environment",
  {
    skip: python.status !== 0 ? "Optional check requires Python 3 with jinja2 installed" : false,
  },
  () => {
    const states: Record<
      string,
      { state: string; name?: string; attributes?: Record<string, unknown> }
    > = {
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
      "floor:ground": ["light.hall", "light.pool"],
    }
    const cases: [unknown, unknown, number | undefined, string[]][] = [
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
      [{ domain: "sensor", "attr.battery": ">= 80" }, undefined, undefined, ["sensor.high"]],
      [{ domain: "sensor", "attr.present": true }, undefined, undefined, ["sensor.low"]],
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
      [{ entity_id: "sensor.low", "attr.absent": null }, undefined, undefined, ["sensor.low"]],
      [
        { device: "device_id" },
        { by: "attr.battery", numeric: true },
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
      registry: {
        "sensor.low": { device_id: "device_id", entity_name: "Low" },
        "sensor.high": { device_id: "device_id", entity_name: "High" },
      },
      devices: { device_id: { name: "Device" } },
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
    rendered(result.stdout).forEach((actual, index) => {
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
    const states: Record<
      string,
      { state: string; name?: string; attributes?: Record<string, unknown> }
    > = {
      "light.z": { state: "on", name: "Same", attributes: { device_class: "light" } },
      "light.a": { state: "off", name: "same", attributes: { device_class: "light" } },
      "sensor.z": { state: "12", name: "A", attributes: { device_class: "battery" } },
      "sensor.a": { state: "3", name: "Z", attributes: { device_class: "temperature" } },
      "sensor.missing": { state: "unavailable", name: "0" },
    }
    const row = (entity: string, group = 0) => ({ entity, group })
    const groups = [{ domain: "light" }, { domain: "sensor" }]
    const cases: [string, Record<string, unknown>, { entity: string; group: number }[]][] = [
      [
        "explicit group/name, with entity-ID fallback",
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
        { include: groups, sort: [{ by: "group" }, { by: "state", numeric: true }] },
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
          sort: [{ by: "group" }, { by: "state", numeric: true, reverse: true }],
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
        { include: groups, sort: [{ by: "group", reverse: true }, { by: "name" }] },
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
      ["entity type", { include: { domain: "sensor", type: "sensor/battery" } }, [row("sensor.z")]],
      [
        "contradictory device class constraints are ANDed",
        {
          include: {
            domain: "sensor",
            type: "sensor/battery",
            "attr.device_class": "temperature",
          },
        },
        [],
      ],
      [
        "class list",
        { include: { domain: "sensor", type: ["sensor/battery", "sensor/temperature"] } },
        [row("sensor.z"), row("sensor.a")],
      ],
      [
        "global nested exclusion",
        {
          include: groups,
          exclude: { any: [{ "attr.device_class": "battery" }, { not: { domain: "sensor" } }] },
        },
        [row("sensor.missing", 1), row("sensor.a", 1)],
      ],
    ]
    const many = Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [`sensor.group_${i}`, { state: "0", name: "Same" }])
    )
    const manyIncludes = Object.keys(many).map((entity_id) => ({ entity_id }))
    const payload = cases.map(([, config]) => ({
      template: normalizeConfig({ ...config, sort: config.sort ?? ["group", "name"] }).query
        .template,
      states,
    }))
    payload.push({
      template: normalizeConfig({ include: manyIncludes, sort: "group" }).query.template,
      states: many,
    })
    const output = spawnSync(
      "python3",
      [fileURLToPath(new URL("./render-template.py", import.meta.url))],
      { input: JSON.stringify(payload), encoding: "utf8" }
    )
    assert.equal(output.status, 0, output.stderr)
    const results = rendered(output.stdout)
    cases.forEach(([name, , expected], i) => assert.deepEqual(results[i].result, expected, name))
    assert.deepEqual(
      results.at(-1)!.result,
      Object.keys(many).map((entity, group) => row(entity, group)),
      "include sorting is numeric, not lexicographic"
    )
  }
)

test(
  "hidden filtering uses registry flags in includes, exclusions, and nested rules",
  {
    skip: python.status !== 0 ? "Optional check requires Python 3 with jinja2 installed" : false,
  },
  () => {
    const states: Record<
      string,
      { state: string; name?: string; attributes?: Record<string, unknown> }
    > = {
      "light.user_hidden": { state: "on" },
      "light.integration_hidden": { state: "off" },
      "light.visible": { state: "on" },
      "light.unregistered": { state: "off", attributes: { hidden: true } },
    }
    const registry = {
      "light.user_hidden": { hidden_by: "user" },
      "light.integration_hidden": { hidden_by: "integration" },
      "light.visible": { hidden_by: null },
    }
    const hidden = ["light.user_hidden", "light.integration_hidden"]
    const visible = ["light.visible", "light.unregistered"]
    const cases: [Record<string, unknown>, string[]][] = [
      [{ include: { domain: "light", hidden: true } }, hidden],
      [{ include: { domain: "light", hidden: false } }, visible],
      [{ include: { domain: "light" }, exclude: { hidden: true } }, visible],
      [{ include: { domain: "light" }, exclude: { hidden: false } }, hidden],
      [{ include: { domain: "light", not: { hidden: true } } }, visible],
      [{ include: { domain: "light", all: [{ hidden: true }, { state: "on" }] } }, [hidden[0]]],
      [
        { include: { domain: "light", any: [{ hidden: true }, { state: "off" }] } },
        [...hidden, visible[1]],
      ],
      [{ include: { domain: "light" } }, [...hidden, ...visible]],
      [
        { include: [{ domain: "light", hidden: true }, { domain: "light" }] },
        [...hidden, ...visible],
      ],
    ]
    const payload = cases.map(([config]) => ({
      template: normalizeConfig({ ...config, sort: [] }).query.template,
      states,
      registry,
    }))
    const output = spawnSync(
      "python3",
      [fileURLToPath(new URL("./render-template.py", import.meta.url))],
      {
        input: JSON.stringify(payload),
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
    })
  }
)

test(
  "name matching and sorting use modern entity names with device fallback",
  {
    skip: python.status !== 0 ? "Optional check requires Python 3 with jinja2 installed" : false,
  },
  () => {
    const states: Record<
      string,
      { state: string; name?: string; attributes?: Record<string, unknown> }
    > = {
      "sensor.temperature": { state: "20", name: "AAA Pool controller Temperature" },
      "sensor.energy": { state: "12", name: "ZZZ Pool controller Energy" },
      "sensor.main": { state: "on", name: "000 Legacy pump" },
      "sensor.unregistered": { state: "on", name: "Manual" },
      "sensor.unnamed": { state: "on", name: "Legacy name shouldn't leak" },
    }
    const registry = {
      "sensor.temperature": { entity_name: "Temperature", device_id: "controller" },
      "sensor.energy": { entity_name: "Energy", device_id: "controller" },
      "sensor.main": { entity_name: "", next_name_part: "device", device_id: "pump" },
      "sensor.unnamed": { entity_name: "", next_name_part: null },
    }
    const devices = { pump: { name: "Original pump", name_by_user: "Pump" } }
    const ordered = [
      "sensor.unnamed",
      "sensor.energy",
      "sensor.unregistered",
      "sensor.main",
      "sensor.temperature",
    ]
    const cases: [Record<string, unknown>, string[]][] = [
      [{ include: { domain: "sensor", name: "Temperature" } }, ["sensor.temperature"]],
      [{ include: { domain: "sensor", name: "AAA Pool controller Temperature" } }, []],
      [{ include: { domain: "sensor", name: "Pump" } }, ["sensor.main"]],
      [{ include: { domain: "sensor", name: "Original pump" } }, []],
      [{ include: { domain: "sensor", name: "Manual" } }, ["sensor.unregistered"]],
      [{ include: { domain: "sensor", name: "T*" } }, ["sensor.temperature"]],
      [{ include: { domain: "sensor", name: "/^P/" } }, ["sensor.main"]],
      [{ include: { domain: "sensor", name: "" } }, ["sensor.unnamed"]],
      [
        { include: { domain: "sensor", any: [{ name: "Pump" }, { name: "Energy" }] } },
        ["sensor.energy", "sensor.main"],
      ],
      [
        { include: { domain: "sensor" }, exclude: { name: "Pump" } },
        ordered.filter((id) => id !== "sensor.main"),
      ],
      [{ include: { domain: "sensor" } }, ordered],
      [
        { include: { domain: "sensor" }, sort: { by: "name", reverse: true } },
        [...ordered].reverse(),
      ],
      [
        { include: { domain: "sensor" }, sort: "attr.friendly_name" },
        [
          "sensor.energy",
          "sensor.main",
          "sensor.temperature",
          "sensor.unnamed",
          "sensor.unregistered",
        ],
      ],
    ]
    const output = spawnSync(
      "python3",
      [fileURLToPath(new URL("./render-template.py", import.meta.url))],
      {
        input: JSON.stringify(
          cases.map(([config]) => ({
            template: normalizeConfig(config).query.template,
            states,
            registry,
            devices,
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
    })
  }
)

test(
  "attribute notation, array NOT, and sort shorthand execute with literal-key semantics",
  {
    skip: python.status !== 0 ? "Optional check requires Python 3 with jinja2 installed" : false,
  },
  () => {
    const odd = "x') }} {{ boom"
    const states: Record<
      string,
      { state: string; name?: string; attributes?: Record<string, unknown> }
    > = {
      "sensor.a": {
        state: "on",
        name: "A",
        attributes: {
          level: 2,
          present: true,
          "meta.level": 9,
          meta: { level: 1 },
          "battery:type": "CR2032",
          [odd]: true,
        },
      },
      "sensor.b": {
        state: "off",
        name: "B",
        attributes: {
          level: 10,
          present: false,
          "meta.level": 2,
          meta: { level: 9 },
          "battery:type": "AA",
        },
      },
      "sensor.c": { state: "unavailable", name: "C" },
      "sensor.d": {
        state: "on",
        name: "D",
        attributes: { level: 3, "meta.level": 4, "battery:type": "AAA" },
      },
    }
    const registry = {
      "sensor.a": { hidden_by: "user", entity_name: "A" },
      "sensor.c": { hidden_by: "integration", entity_name: "C" },
    }
    const all = Object.keys(states)
    const cases: [Record<string, unknown>, string[]][] = [
      [
        { include: { domain: "sensor", not: [{ hidden: true }, { state: "unavailable" }] } },
        ["sensor.b", "sensor.d"],
      ],
      [
        { include: { domain: "sensor", not: { hidden: true, state: "unavailable" } } },
        ["sensor.a", "sensor.b", "sensor.d"],
      ],
      [
        {
          include: { domain: "sensor", not: { not: [{ hidden: true }, { state: "unavailable" }] } },
        },
        ["sensor.a", "sensor.c"],
      ],
      [{ include: { domain: "sensor", not: [] } }, all],
      [{ include: { domain: "sensor", not: {} } }, []],
      [{ include: { domain: "sensor", not: [{}] } }, []],
      [
        {
          include: { domain: "sensor" },
          exclude: { not: [{ hidden: true }, { state: "unavailable" }] },
        },
        ["sensor.a", "sensor.c"],
      ],
      [{ include: { domain: "sensor", "attr.level": "> 2" } }, ["sensor.b", "sensor.d"]],
      [{ include: { domain: "sensor", "attr.present": true } }, ["sensor.a"]],
      [{ include: { domain: "sensor", "attr.meta.level": 9 } }, ["sensor.a"]],
      [{ include: { domain: "sensor", "attr.meta.level": 1 } }, []],
      [
        { include: { domain: "sensor", "attr.battery:type": ["CR2032", "AA"] } },
        ["sensor.a", "sensor.b"],
      ],
      [{ include: { domain: "sensor", [`attr.${odd}`]: true } }, ["sensor.a"]],
      [{ include: { domain: "sensor", "attr.absent": null } }, all],
      [
        { include: { domain: "sensor" }, sort: "attr.level" },
        ["sensor.c", "sensor.b", "sensor.a", "sensor.d"],
      ],
      [
        { include: { domain: "sensor" }, sort: { by: "attr.level", numeric: true } },
        ["sensor.a", "sensor.d", "sensor.b", "sensor.c"],
      ],
      [
        { include: { domain: "sensor" }, sort: { by: "attr.meta.level", numeric: true } },
        ["sensor.b", "sensor.d", "sensor.a", "sensor.c"],
      ],
      [
        {
          include: { domain: "sensor" },
          sort: ["group", { by: "attr.level", numeric: true, reverse: true }, "name"],
        },
        ["sensor.b", "sensor.d", "sensor.a", "sensor.c"],
      ],
      [{ include: { domain: "sensor" }, sort: "name" }, all],
      [{ include: { domain: "sensor" }, sort: ["group", "name"] }, all],
    ]
    const output = spawnSync(
      "python3",
      [fileURLToPath(new URL("./render-template.py", import.meta.url))],
      {
        input: JSON.stringify(
          cases.map(([config]) => ({
            template: normalizeConfig(config).query.template,
            states,
            registry,
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
    })
  }
)
