import assert from "node:assert/strict"
import { test } from "node:test"
import { compileFilter, normalizeConfig, normalizeEntities } from "../src/query.ts"

test("defaults to two columns of native tiles, without mutating caller config", () => {
  const input = { filter: { area: "pool", domain: "light" }, options: { name: { type: "entity" } } }
  const original = structuredClone(input)
  const config = normalizeConfig(input)
  assert.equal(config.columns, 2)
  assert.equal(config.square, false)
  assert.equal(config.show_empty, false)
  assert.equal(normalizeConfig({ entities: [], show_empty: true }).show_empty, true)
  assert.deepEqual(config.options, { type: "tile", name: { type: "entity" } })
  config.options.name.type = "device"
  assert.deepEqual(input, original)
})

test("area queries restrict candidates and hoist registry helpers outside the entity loop", () => {
  const query = compileFilter({ area: "pool", domain: "light", state: "on" })
  assert.equal(query.match(/area_entities\("pool"\)/g).length, 1)
  assert.match(query, /for entity in \(ag_members_0\)/)
  assert.doesNotMatch(query, /states \| map/)
})

test("domain queries avoid iterating all states", () => {
  const query = compileFilter({ domain: ["light", "switch"] })
  assert.match(query, /states.light/)
  assert.match(query, /states.switch/)
  assert.doesNotMatch(query, /states \| map/)
})

test("AND constraints can restrict candidates, but OR and NOT cannot", () => {
  assert.match(
    compileFilter({ all: [{ area: "pool" }, { state: "on" }] }),
    /for entity in \(ag_members_0\)/
  )
  assert.match(compileFilter({ any: [{ area: "pool" }, { domain: "light" }] }), /states \| map/)
  assert.match(compileFilter({ not: { domain: "light" } }), /states \| map/)
})

test("literal entity IDs avoid a full state scan; wildcard IDs don't", () => {
  assert.doesNotMatch(compileFilter({ entity_id: ["light.pool", "light.hall"] }), /states \| map/)
  assert.match(compileFilter({ entity_id: "light.*" }), /states \| map/)
})

test("template input remains a template, static lists are deduplicated", () => {
  assert.equal(
    normalizeConfig({ entities: "{{ area_entities('pool') }}" }).template,
    "{{ area_entities('pool') }}"
  )
  assert.deepEqual(normalizeConfig({ entities: ["light.pool", "light.pool"] }).entities, [
    "light.pool",
  ])
  assert.deepEqual(normalizeConfig({ entities: ["light.pool"], limit: 0 }).entities, [])
  assert.match(
    normalizeConfig({ entities: ["light.pool"], sort: { by: "name" } }).template,
    /sort\(/
  )
})

test("validates query results without interpreting arbitrary strings or configurations", () => {
  assert.deepEqual(normalizeEntities(["light.pool", "light.pool", "sensor.power"]), [
    "light.pool",
    "sensor.power",
  ])
  for (const invalid of [
    undefined,
    "light.pool",
    "['light.pool']",
    [{ entity: "light.pool" }],
    ["bad"],
    [null],
  ]) {
    assert.throws(() => normalizeEntities(invalid), /list of entity IDs/)
  }
})

test("invalid configuration is rejected early", () => {
  for (const config of [
    {},
    { filter: {}, entities: [] },
    { entities: "light.pool" },
    { entities: [], columns: 0 },
    { entities: [], columns: 1.5 },
    { entities: [], square: "false" },
    { entities: [], show_empty: "false" },
    { entities: [], options: { entity: "light.pool" } },
    { entities: [], options: { type: 3 } },
    { entities: [], options: [] },
    { filter: { typo: "pool" } },
    { filter: { domain: "light.*" } },
    { filter: { area: [] } },
    { filter: { any: {} } },
    { filter: { state: {} } },
    { filter: { attributes: [] } },
    { filter: { state: [] } },
    { filter: {}, sort: { by: "nope" } },
    { filter: {}, sort: { by: "attribute" } },
    { filter: {}, sort: { by: "name", reverse: "false" } },
    { filter: {}, limit: -1 },
    { entities: "{{ [] }}", sort: { by: "name" } },
  ])
    assert.throws(() => normalizeConfig(config), undefined, JSON.stringify(config))
})

test("quotes user input rather than interpolating Jinja source", () => {
  const text = `pool') }}{% set danger = true %}{{ ('`
  assert.ok(compileFilter({ area: text }).includes(`area_entities(${JSON.stringify(text)})`))
})

test("limits, numeric comparison, and sorting are compiled into the backend query", () => {
  const query = compileFilter(
    { domain: "sensor", state: "< 20" },
    { by: "state", numeric: true, reverse: true },
    5
  )
  assert.match(query, /is_number\(states\(entity\)\)/)
  assert.match(query, /float\) < 20/)
  assert.match(query, /reverse=true/)
  assert.match(query, /result\[:5\]/)
})
