import type { QuerySection } from "../src/types.ts"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { fieldTitle, fieldValue } from "../src/query.ts"
import { normalizeConfig, rendered } from "./helpers.ts"

const query = (include: unknown, extra: Record<string, unknown> = {}) =>
  normalizeConfig({ include, ...extra }).query.template

test("entity type syntax is validated and narrows candidates to unique domains", () => {
  const template = query({
    type: ["sensor/battery", "sensor/temperature", "binary_sensor/battery"],
  })
  assert.equal(template.match(/states.sensor \| map/g)!.length, 1)
  assert.match(template, /states.binary_sensor \| map/)
  assert.doesNotMatch(template, /states \| map/)
  assert.doesNotMatch(query({ all: [{ type: "sensor/battery" }] }), /states \| map/)
  assert.match(query({ not: { type: "sensor/battery" } }), /states \| map/)
  assert.match(query({ any: [{ type: "light" }, { type: "sensor" }] }), /states \| map/)
  for (const type of [
    null,
    [],
    {},
    1,
    "",
    "sensor/",
    "/battery",
    "sensor/battery/extra",
    "sensor/*",
    "Sensor",
    "sensor/battery ",
    ["sensor", null],
  ]) {
    assert.throws(() => normalizeConfig({ include: { type } }))
  }
  assert.throws(() => normalizeConfig({ include: { device_class: "battery" } }), /Unknown filter/)
  assert.throws(() => normalizeConfig({ include: {}, sort: "device_class" }), /Unknown sort/)
  assert.throws(() => normalizeConfig({ include: {}, group: "device_class" }), /Unknown group/)
  assert.ok(query({}, { sort: "type" }).includes(fieldValue("type", 0)))
  assert.equal(
    fieldTitle("type"),
    "(group.split('/')[-1].split('_') | map('capitalize') | join(' '))"
  )
  assert.equal(fieldTitle("domain"), "(group.split('_') | map('capitalize') | join(' '))")
  assert.match(fieldTitle("integration"), /ag_integration_names/)
  assert.equal(fieldTitle("area"), "(group if group is not none else '')")
})

const python = spawnSync("python3", ["-c", "import jinja2"], { encoding: "utf8" })
test(
  "HA-style type matching, sorting, group titles, and final group_count execute correctly",
  {
    skip: python.status !== 0 ? "Optional check requires Python 3 with jinja2 installed" : false,
  },
  () => {
    const states = {
      "light.a": { state: "on", name: "A" },
      "light.b": { state: "on", name: "B", attributes: { device_class: "" } },
      "sensor.battery": { state: "90", name: "C", attributes: { device_class: "battery" } },
      "sensor.temperature": { state: "20", name: "D", attributes: { device_class: "temperature" } },
      "binary_sensor.battery": { state: "off", name: "E", attributes: { device_class: "battery" } },
      "sensor.plain": { state: "0", name: "F" },
      "sensor.null": { state: "0", name: "G", attributes: { device_class: null } },
      "sensor.empty": { state: "0", name: "H", attributes: { device_class: "" } },
    }
    const all = Object.keys(states),
      sensors = all.filter((id) => id.startsWith("sensor."))
    const selection = { type: ["light", "sensor", "binary_sensor"] }
    const cases: [Record<string, unknown>, string[]][] = [
      [{ include: { type: "sensor" } }, sensors],
      [{ include: { type: "sensor/battery" } }, ["sensor.battery"]],
      [
        { include: { type: ["light", "binary_sensor/battery"] } },
        ["light.a", "light.b", "binary_sensor.battery"],
      ],
      [{ include: { type: "sensor", domain: "binary_sensor" } }, []],
      [{ include: { type: "sensor/battery", "attr.device_class": "temperature" } }, []],
      [
        { include: { "attr.device_class": "battery" } },
        ["sensor.battery", "binary_sensor.battery"],
      ],
      [
        { include: selection, exclude: { type: "sensor/battery" } },
        all.filter((id) => id !== "sensor.battery"),
      ],
      [{ include: { not: [{ type: "sensor/battery" }, { type: "light" }] } }, all.slice(3)],
      [
        { include: { any: [{ type: "sensor/battery" }, { type: "binary_sensor/battery" }] } },
        ["sensor.battery", "binary_sensor.battery"],
      ],
      [
        { include: selection, sort: ["type", "name"] },
        [
          "binary_sensor.battery",
          "light.a",
          "light.b",
          "sensor.plain",
          "sensor.null",
          "sensor.empty",
          "sensor.battery",
          "sensor.temperature",
        ],
      ],
    ]
    const section = (value: unknown, title: string, entities: string[]) => ({
      value,
      title,
      entities,
    })
    const grouped: [Record<string, unknown>, ReturnType<typeof section>[]][] = [
      [
        { include: selection, group: "type" },
        [
          section("light", "Light", ["light.a", "light.b"]),
          section("sensor/battery", "Battery", ["sensor.battery"]),
          section("sensor/temperature", "Temperature", ["sensor.temperature"]),
          section("binary_sensor/battery", "Battery", ["binary_sensor.battery"]),
          section("sensor", "Sensor", ["sensor.plain", "sensor.null", "sensor.empty"]),
        ],
      ],
      [
        {
          include: { type: "sensor" },
          group: { by: "type", $heading: "{{ group_name }} / {{ group }} / {{ group_count }}" },
        },
        [
          section("sensor/battery", "Battery / sensor/battery / 3", ["sensor.battery"]),
          section("sensor/temperature", "Temperature / sensor/temperature / 3", [
            "sensor.temperature",
          ]),
          section("sensor", "Sensor / sensor / 3", ["sensor.plain", "sensor.null", "sensor.empty"]),
        ],
      ],
      [
        { include: selection, group: { by: "type", $heading: "{{ group_count }}" }, limit: 1 },
        [section("light", "1", ["light.a"])],
      ],
      [
        { include: selection, group: { by: "type", $heading: "{{ group_count }}" }, limit: 3 },
        [
          section("light", "2", ["light.a", "light.b"]),
          section("sensor/battery", "2", ["sensor.battery"]),
        ],
      ],
      [
        {
          include: selection,
          exclude: { not: { type: "light" } },
          group: { by: "type", $heading: "{{ group_count }}" },
        },
        [section("light", "1", ["light.a", "light.b"])],
      ],
      [{ include: selection, group: { by: "type", $heading: "{{ group_count }}" }, limit: 0 }, []],
    ]
    const configs = [...cases, ...grouped]
    const output = spawnSync(
      "python3",
      [fileURLToPath(new URL("render-template.py", import.meta.url))],
      {
        input: JSON.stringify(
          configs.map(([config]) => ({ states, template: normalizeConfig(config).query.template }))
        ),
        encoding: "utf8",
      }
    )
    assert.equal(output.status, 0, output.stderr)
    const results = rendered(output.stdout)
    const groupResults = rendered<QuerySection[]>(output.stdout)
    cases.forEach(([config, expected], i) =>
      assert.deepEqual(
        results[i].result.map(({ entity }) => entity),
        expected,
        JSON.stringify(config)
      )
    )
    grouped.forEach(([config, expected], i) =>
      assert.deepEqual(
        groupResults[cases.length + i].result.map(({ value, title, matches }) => ({
          value,
          title,
          entities: matches.map(({ entity }) => entity),
        })),
        expected,
        JSON.stringify(config)
      )
    )
  }
)

test(
  "domain/type headings prettify underscore-separated identifiers without changing values",
  {
    skip: python.status !== 0 ? "Optional check requires Python 3 with jinja2 installed" : false,
  },
  () => {
    const states = {
      "binary_sensor.a": {
        name: "A",
        state: "on",
        attributes: { device_class: "carbon_monoxide", category: "raw_category" },
      },
      "device_tracker.b": { name: "B", state: "home", attributes: { category: "raw_category" } },
      "sensor.c": {
        name: "C",
        state: "10",
        attributes: { device_class: "volatile_organic_compounds", category: "raw_category" },
      },
    }
    const include = { entity_id: Object.keys(states) }
    const cases: [Record<string, unknown>, [string, string][]][] = [
      [
        { by: "domain" },
        [
          ["binary_sensor", "Binary Sensor"],
          ["device_tracker", "Device Tracker"],
          ["sensor", "Sensor"],
        ],
      ],
      [
        { by: "type" },
        [
          ["binary_sensor/carbon_monoxide", "Carbon Monoxide"],
          ["device_tracker", "Device Tracker"],
          ["sensor/volatile_organic_compounds", "Volatile Organic Compounds"],
        ],
      ],
      [
        { by: "type", $heading: "{{ group }}|{{ group_name }}" },
        [
          ["binary_sensor/carbon_monoxide", "binary_sensor/carbon_monoxide|Carbon Monoxide"],
          ["device_tracker", "device_tracker|Device Tracker"],
          [
            "sensor/volatile_organic_compounds",
            "sensor/volatile_organic_compounds|Volatile Organic Compounds",
          ],
        ],
      ],
      [{ by: "attr.category" }, [["raw_category", "raw_category"]]],
    ]
    const output = spawnSync(
      "python3",
      [fileURLToPath(new URL("render-template.py", import.meta.url))],
      {
        input: JSON.stringify(
          cases.map(([group]) => ({
            states,
            template: normalizeConfig({ include, group }).query.template,
          }))
        ),
        encoding: "utf8",
      }
    )
    assert.equal(output.status, 0, output.stderr)
    rendered<QuerySection[]>(output.stdout).forEach((actual, i) =>
      assert.deepEqual(
        actual.result.map(({ value, title }) => [value, title]),
        cases[i][1]
      )
    )
    for (const field of ["area", "floor", "device", "label", "name", "group"] as const) {
      assert.equal(fieldTitle(field), "(group if group is not none else '')")
    }
  }
)
