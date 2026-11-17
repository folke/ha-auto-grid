import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { normalizeConfig, rendered } from "./helpers.ts"
import { renderCardOptions } from "../src/card-templates.ts"

const query = (include: unknown, extra: Record<string, unknown> = {}) =>
  normalizeConfig({ include, ...extra }).query.template

test("entity_id JSON arrays compile identically to native lists, including empty selections", () => {
  for (const ids of [
    [],
    ["sensor.b", "sensor.a"],
    ["sensor.a", "sensor.a"],
    ["sensor.*", "/^light[.]/"],
  ]) {
    assert.equal(query({ entity_id: ` \n ${JSON.stringify(ids)} ` }), query({ entity_id: ids }))
    assert.equal(
      query({ not: { entity_id: JSON.stringify(ids) } }),
      query({ not: { entity_id: ids } })
    )
    assert.equal(
      query({}, { exclude: { entity_id: JSON.stringify(ids) } }),
      query({}, { exclude: { entity_id: ids } })
    )
  }
  assert.doesNotMatch(query({ entity_id: '["sensor.b", "sensor.a"]' }), /states \| map/)
  assert.doesNotMatch(query({ entity_id: "[]" }), /states \| map/)
  assert.match(query({ entity_id: '["sensor.*"]' }), /states \| map/)
  for (const value of ["['sensor.a']", "[", '["sensor.a",]', '["sensor.a"] trailing']) {
    assert.throws(() => query({ entity_id: value }), /valid JSON array.*to_json/)
  }
  for (const value of ["[null]", "[true]", "[3]", "[{}]", "[[]]", '[""]', '["  "]']) {
    assert.throws(() => query({ entity_id: value }), /non-empty strings/)
  }
  assert.ok(query({ name: '["sensor.a"]' }).includes('== "[\\\"sensor.a\\\"]"'))
  assert.throws(() => query({ domain: "[]" }))
  assert.throws(() => query({ area: [] }))
  assert.throws(() => query({ state: [] }))
})

const python = spawnSync("python3", ["-c", "import jinja2"], { encoding: "utf8" })
const execute = (cases: unknown[]) => {
  const output = spawnSync(
    "python3",
    [fileURLToPath(new URL("./render-template.py", import.meta.url))],
    {
      input: JSON.stringify(cases),
      encoding: "utf8",
    }
  )
  assert.equal(output.status, 0, output.stderr)
  return rendered(output.stdout).map(({ result }) => result)
}

test(
  "JSON entity lists preserve order, patterns, exclusions, and empty-list semantics",
  {
    skip: python.status !== 0 ? "Optional check requires Python 3 with jinja2 installed" : false,
  },
  () => {
    const states = {
      "sensor.a": { state: "0", name: "A" },
      "sensor.b": { state: "0", name: "B" },
      "light.c": { state: "on", name: "C" },
    }
    const cases: [Record<string, unknown>, string[]][] = [
      [
        {
          include: { entity_id: '["sensor.b", "sensor.a", "sensor.b", "sensor.missing"]' },
          sort: [],
        },
        ["sensor.b", "sensor.a"],
      ],
      [{ include: { entity_id: '["sensor.b", "sensor.a"]' } }, ["sensor.a", "sensor.b"]],
      [{ include: { entity_id: "[]" } }, []],
      [{ include: { entity_id: [] } }, []],
      [{ include: { any: [{ entity_id: "[]" }, { entity_id: "light.c" }] } }, ["light.c"]],
      [{ include: { not: { entity_id: "[]" } } }, Object.keys(states)],
      [{ include: {}, exclude: { entity_id: "[]" } }, Object.keys(states)],
      [{ include: { entity_id: '["sensor.*", "/^light[.]/"]' } }, Object.keys(states)],
      [
        {
          include: { entity_id: '["sensor.*", "light.c"]' },
          exclude: { entity_id: '["sensor.a"]' },
        },
        ["sensor.b", "light.c"],
      ],
    ]
    execute(
      cases.map(([config]) => ({ states, template: normalizeConfig(config).query.template }))
    ).forEach((rows, i) => {
      assert.deepEqual(
        rows.map(({ entity }) => entity),
        cases[i][1],
        JSON.stringify(cases[i][0])
      )
    })
  }
)

test(
  "a parent $entity_id template feeds literal child candidates into a nested grid",
  {
    skip: python.status !== 0 ? "Optional check requires Python 3 with jinja2 installed" : false,
  },
  () => {
    const states = {
      "pyscript.alert_example": {
        state: "firing",
        name: "Alert",
        attributes: { entities: ["sensor.b", "sensor.a"] },
      },
      "pyscript.alert_empty": { state: "firing", name: "Empty" },
      "sensor.a": { state: "0", name: "A" },
      "sensor.b": { state: "0", name: "B" },
    }
    const outer = normalizeConfig({
      include: { entity_id: ["pyscript.alert_example", "pyscript.alert_empty"] },
      card: {
        type: "custom:auto-grid",
        sort: [],
        include: [
          { $entity_id: "{{ entity }}", card: { type: "tile" } },
          {
            $entity_id: "{{ state_attr(entity, 'entities') | default([], true) | to_json }}",
            card: { type: "custom:mushroom-entity-card" },
          },
        ],
      },
    })
    const [matches] = execute([{ states, template: outer.query.template }])
    const children = matches.map((row) =>
      normalizeConfig(
        renderCardOptions(
          outer.query.cards[row.group],
          outer.query.templates[row.group],
          row.values,
          row.entity
        )
      )
    )
    children.forEach((child) => assert.doesNotMatch(child.query.template, /states \| map/))
    const results = execute(children.map((child) => ({ states, template: child.query.template })))
    const resultByEntity = new Map(
      matches.map((row, i) => [row.entity, results[i].map(({ entity }) => entity)])
    )
    assert.deepEqual(resultByEntity.get("pyscript.alert_example"), [
      "pyscript.alert_example",
      "sensor.b",
      "sensor.a",
    ])
    assert.deepEqual(resultByEntity.get("pyscript.alert_empty"), ["pyscript.alert_empty"])
  }
)
