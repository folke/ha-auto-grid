import type { QuerySection } from "../src/types.ts"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { normalizeResult } from "../src/query.ts"
import { normalizeConfig, rendered } from "./helpers.ts"

const python = spawnSync("python3", ["-c", "import jinja2"], { encoding: "utf8" })
const selection = [
  { group: "Lights", domain: "light" },
  { group: "Sensors", domain: "sensor" },
]

test("group configuration normalizes shorthand and validates fields", () => {
  for (const group of [true, {}, { by: "group" }, "group"]) {
    assert.deepEqual(normalizeConfig({ include: selection, group }).query.group, {
      by: "group",
      heading: { type: "heading", heading_style: "subtitle", $heading: "{{ group_name }}" },
    })
  }
  assert.equal(normalizeConfig({ include: selection }).query.group, undefined)
  assert.equal(normalizeConfig({ include: selection, group: false }).query.group, undefined)
  assert.deepEqual(normalizeConfig({ include: selection, group: "area" }).query.group, {
    by: "area",
    heading: { type: "heading", heading_style: "subtitle", $heading: "{{ group_name }}" },
  })
  for (const group of [
    null,
    1,
    [],
    "include",
    "nope",
    "all",
    "attr.",
    { by: "nope" },
    { by: null },
    { title: 1 },
    { invalid: true },
  ]) {
    assert.throws(() => normalizeConfig({ include: selection, group }))
  }
  assert.throws(() => normalizeConfig({ include: { group: 2, domain: "light" } }), /include.group/)
  assert.throws(() => normalizeConfig({ include: { not: { group: "Lights" } } }), /Unknown filter/)
  assert.throws(() => normalizeConfig({ include: {}, sort: "include" }), /Unknown sort/)
  assert.equal(
    normalizeConfig({ include: selection, group: false }).query.template,
    normalizeConfig({ include: selection }).query.template
  )
})

test("group heading templates require explicit dollar keys and preserve literal strings", () => {
  const source = "{{ group_name }}"
  const shorthand = normalizeConfig({ include: selection, group: { by: "area", $heading: source } })
  const full = normalizeConfig({
    include: selection,
    group: { by: "area", heading: { $heading: source } },
  })
  assert.deepEqual(shorthand.query, full.query)
  const literal = normalizeConfig({ include: selection, group: { by: "area", heading: source } })
  assert.equal(literal.query.group!.heading.heading, source)
  assert.equal(literal.query.group!.heading.$heading, undefined)
  for (const group of [
    { heading: "Static", $heading: source },
    { heading: {}, $heading: source },
    { $heading: null },
    { $heading: 3 },
  ])
    assert.throws(() => normalizeConfig({ include: selection, group }))
})

test("grouped results validate types and retain number/string/boolean identities", () => {
  const config = normalizeConfig({ include: {}, group: true })
  const sections = [0, "0", false, null, ["a"], { a: 1 }].map((value, i) => ({
    value,
    title: JSON.stringify(value),
    heading: { type: "heading", heading_style: "subtitle", heading: JSON.stringify(value) },
    matches: [{ entity: `light.item_${i}`, group: 0 }],
  }))
  const result = normalizeResult(sections, config)
  assert.equal(new Set(result.sections!.map(({ key }) => key)).size, 6)
  assert.equal(result.matches.length, 6)
  for (const invalid of [
    null,
    [{ title: "x", value: undefined, matches: [] }],
    [{ title: 1, value: "a", matches: [] }],
    [{ title: "x", value: "a", matches: [] }],
    [sections[0], sections[0]],
    [sections[0], { ...sections[1], matches: sections[0].matches }],
  ]) {
    assert.throws(() => normalizeResult(invalid, config))
  }
})

test(
  "backend grouping merges values, renders titles, and preserves sorted membership",
  {
    skip: python.status !== 0 ? "Optional check requires Python 3 with jinja2 installed" : false,
  },
  () => {
    const payload: {
      states: Record<string, { name: string; state: string; attributes?: Record<string, unknown> }>
      registry: Record<string, unknown>
      devices: Record<string, unknown>
      areas: Record<string, unknown>
      labels: Record<string, unknown>
      config_entries: Record<string, unknown>
    } = {
      states: {
        "light.a": { state: "on", name: "A", attributes: { bucket: 1 } },
        "sensor.b": { state: "on", name: "B", attributes: { bucket: 1 } },
        "light.c": { state: "off", name: "C", attributes: { bucket: true } },
        "sensor.d": { state: "off", name: "D", attributes: { bucket: "1" } },
        "sensor.e": { state: "on", name: "E" },
      },
      registry: {
        "light.a": {
          entity_name: "A",
          device_id: "a",
          area_id: "pool",
          labels: ["z", "a"],
          config_entry_id: "mqtt_one",
        },
        "sensor.b": { entity_name: "B", area_id: "kitchen", config_entry_id: "mqtt_two" },
        "light.c": {
          entity_name: "C",
          device_id: "c",
          area_id: "pool",
          labels: ["a", "z"],
          config_entry_id: "zha_one",
        },
        "sensor.d": { entity_name: "D", area_id: "kitchen" },
      },
      devices: { a: { name: "Repeated" }, c: { name: "Repeated" } },
      areas: { pool: { name: "Pool" }, kitchen: { name: "Kitchen" } },
      labels: { a: { name: "Alpha" }, z: { name: "Zulu" } },
      config_entries: {
        mqtt_one: { domain: "mqtt" },
        mqtt_two: { domain: "mqtt" },
        zha_one: { domain: "zha" },
      },
    }
    const firstObject = { x: 1, y: [true, "1"] }
    const secondObject = { x: 1, y: [1, "1"] }
    const thirdObject = { x: 1, y: [true, 1] }
    payload.states["light.a"].attributes!.complex = firstObject
    payload.states["sensor.b"].attributes!.complex = { y: [true, "1"], x: 1 }
    payload.states["light.c"].attributes!.complex = secondObject
    payload.states["sensor.d"].attributes!.complex = thirdObject
    const section = (value: unknown, title: string, ...entities: string[]) => ({
      value,
      title,
      entities,
    })
    const cases: [Record<string, unknown>, ReturnType<typeof section>[]][] = [
      [
        { include: selection, group: true },
        [
          section("Lights", "Lights", "light.a", "light.c"),
          section("Sensors", "Sensors", "sensor.b", "sensor.d", "sensor.e"),
        ],
      ],
      [
        { include: selection.map((i) => ({ ...i, group: "Everything" })), group: true },
        [
          section(
            "Everything",
            "Everything",
            "light.a",
            "sensor.b",
            "light.c",
            "sensor.d",
            "sensor.e"
          ),
        ],
      ],
      [
        { include: [{ domain: "light" }, { domain: "sensor", group: "0" }], group: true },
        [
          section(0, "0", "light.a", "light.c"),
          section("0", "0", "sensor.b", "sensor.d", "sensor.e"),
        ],
      ],
      [
        { include: selection, group: "area" },
        [
          section("Pool", "Pool", "light.a", "light.c"),
          section("Kitchen", "Kitchen", "sensor.b", "sensor.d"),
          section(null, "", "sensor.e"),
        ],
      ],
      [
        { include: selection, group: "device" },
        [
          section("Repeated", "Repeated", "light.a", "light.c"),
          section(null, "", "sensor.b", "sensor.d", "sensor.e"),
        ],
      ],
      [
        { include: selection, group: "label" },
        [
          section(["Alpha", "Zulu"], "['Alpha', 'Zulu']", "light.a", "light.c"),
          section([], "[]", "sensor.b", "sensor.d", "sensor.e"),
        ],
      ],
      [
        { include: selection, group: "attr.bucket" },
        [
          section(1, "1", "light.a", "sensor.b"),
          section(true, "True", "light.c"),
          section("1", "1", "sensor.d"),
          section(null, "", "sensor.e"),
        ],
      ],
      [
        { include: selection, group: { by: "attr.complex", heading: "Object" } },
        [
          section(firstObject, "Object", "light.a", "sensor.b"),
          section(secondObject, "Object", "light.c"),
          section(thirdObject, "Object", "sensor.d"),
          section(null, "Object", "sensor.e"),
        ],
      ],
      [
        { include: selection, group: true, limit: 2 },
        [section("Lights", "Lights", "light.a"), section("Sensors", "Sensors", "sensor.b")],
      ],
      [{ include: selection, group: true, limit: 0 }, []],
      [
        { include: selection, group: true, exclude: { domain: "light" } },
        [section("Sensors", "Sensors", "sensor.b", "sensor.d", "sensor.e")],
      ],
      [
        {
          include: selection,
          group: {
            by: "area",
            $heading: "{{ group_name or 'Other' }}: {{ entity }} / {{ states[entity].name }}",
          },
        },
        [
          section("Pool", "Pool: light.a / A", "light.a", "light.c"),
          section("Kitchen", "Kitchen: sensor.b / B", "sensor.b", "sensor.d"),
          section(null, "Other: sensor.e / E", "sensor.e"),
        ],
      ],
      [
        {
          include: selection,
          group: { $heading: "{% if group == 'Lights' %}Lighting{% else %}Other{% endif %}" },
        },
        [
          section("Lights", "Lighting", "light.a", "light.c"),
          section("Sensors", "Other", "sensor.b", "sensor.d", "sensor.e"),
        ],
      ],
      [
        { include: selection, group: { heading: "" } },
        [
          section("Lights", "", "light.a", "light.c"),
          section("Sensors", "", "sensor.b", "sensor.d", "sensor.e"),
        ],
      ],
      [
        { include: selection, group: "integration" },
        [
          section("mqtt", "mqtt", "light.a", "sensor.b"),
          section("zha", "zha", "light.c"),
          section(null, "", "sensor.d", "sensor.e"),
        ],
      ],
      [
        {
          include: selection,
          group: "integration",
          variables: { ag_integration_names: { mqtt: "MQTT", zha: "Zigbee Home Automation" } },
        },
        [
          section("mqtt", "MQTT", "light.a", "sensor.b"),
          section("zha", "Zigbee Home Automation", "light.c"),
          section(null, "", "sensor.d", "sensor.e"),
        ],
      ],
      [
        {
          include: [
            { group: "Z", domain: "light" },
            { group: "A", domain: "sensor" },
          ],
          group: true,
          sort: ["group", "name"],
        },
        [
          section("A", "A", "sensor.b", "sensor.d", "sensor.e"),
          section("Z", "Z", "light.a", "light.c"),
        ],
      ],
      [
        { include: selection, group: "area", sort: [{ by: "name", reverse: true }] },
        [
          section(null, "", "sensor.e"),
          section("Kitchen", "Kitchen", "sensor.d", "sensor.b"),
          section("Pool", "Pool", "light.c", "light.a"),
        ],
      ],
    ]
    const output = spawnSync(
      "python3",
      [fileURLToPath(new URL("render-template.py", import.meta.url))],
      {
        input: JSON.stringify(
          cases.map(([config]) => ({
            ...payload,
            variables: config.variables,
            template: normalizeConfig(config).query.template,
          }))
        ),
        encoding: "utf8",
      }
    )
    assert.equal(output.status, 0, output.stderr)
    rendered<QuerySection[]>(output.stdout).forEach((actual, i) => {
      assert.deepEqual(
        actual.result.map(({ value, title, matches }) => ({
          value,
          title,
          entities: matches.map(({ entity }) => entity),
        })),
        cases[i][1],
        JSON.stringify(cases[i][0])
      )
      normalizeResult(actual.result, normalizeConfig(cases[i][0]))
    })
  }
)

test(
  "group headings render native options and nested $ properties with entity ID context",
  { skip: python.status !== 0 },
  () => {
    const config = normalizeConfig({
      include: { entity: ["light.a", "light.b"] },
      sort: "entity",
      group: {
        by: "entity",
        heading: {
          area: "configured",
          $heading:
            "{{ entity }} / {{ group_name }} / {{ states(entity) }} / {{ group_count }} / {{ area is undefined }} / {{ area_name(entity) }} / {{ area_id(entity) }} / {{ config.area }}",
          $icon: "{{ 'mdi:lightbulb-on' if states(entity) == 'on' else 'mdi:lightbulb' }}",
          heading_style: "title",
          badges: [{ type: "entity", $entity: "{{ entity }}" }],
          tap_action: { action: "url", $url_path: "{{ '/lights/' ~ entity }}" },
        },
      },
    })
    const output = spawnSync(
      "python3",
      [fileURLToPath(new URL("render-template.py", import.meta.url))],
      {
        encoding: "utf8",
        input: JSON.stringify([
          {
            template: config.query.template,
            states: { "light.a": { state: "on" }, "light.b": { state: "off" } },
            registry: { "light.a": { area_id: "kitchen" }, "light.b": { device_id: "b" } },
            devices: { b: { area_id: "hall" } },
            areas: { kitchen: { name: "Kitchen" }, hall: { name: "Hall" } },
          },
        ]),
      }
    )
    assert.equal(output.status, 0, output.stderr)
    const result = normalizeResult(rendered<QuerySection[]>(output.stdout)[0].result, config)
    assert.deepEqual(result.sections![0].heading, {
      area: "configured",
      heading: "light.a / light.a / on / 2 / True / Kitchen / kitchen / configured",
      heading_style: "title",
      icon: "mdi:lightbulb-on",
      type: "heading",
      badges: [{ type: "entity", entity: "light.a" }],
      tap_action: { action: "url", url_path: "/lights/light.a" },
    })
    assert.equal(result.sections![1].heading.icon, "mdi:lightbulb")
    assert.equal(
      result.sections![1].heading.heading,
      "light.b / light.b / off / 2 / True / Hall / hall / configured"
    )
    assert.equal(result.sections![1].heading.entity, undefined)
  }
)
