import assert from "node:assert/strict"
import { test } from "node:test"
import { normalizeConfig, normalizeMatches } from "../src/query.ts"

const query = (include, extra = {}) => normalizeConfig({ include, ...extra }).query.template

test("defaults to two columns of tiles and include/name sorting without mutating input", () => {
  const input = { include: { area: "pool", domain: "light" }, card: { name: { type: "entity" } } }
  const original = structuredClone(input)
  const config = normalizeConfig(input)
  assert.equal(config.columns, 2)
  assert.equal(config.square, false)
  assert.equal(config.show_empty, false)
  assert.equal(normalizeConfig({ include: [], show_empty: true }).show_empty, true)
  assert.deepEqual(config.card, { type: "tile", name: { type: "entity" } })
  assert.match(config.query.template, /sort0/)
  assert.match(config.query.template, /entity_name\(entity, fallback=true\)/)
  assert.doesNotMatch(config.query.template, /states\[entity\].name/)
  config.card.name.type = "device"
  assert.deepEqual(input, original)
})

test("title is optional presentation configuration and does not change the query", () => {
  const base = normalizeConfig({ include: { domain: "light" } })
  assert.equal(base.title, undefined)
  for (const title of ["Pool lights", "", "<b>Lights</b>"]) {
    const config = normalizeConfig({ include: { domain: "light" }, title })
    assert.equal(config.title, title)
    assert.equal(config.query.template, base.query.template)
    assert.deepEqual(config.query.cards, base.query.cards)
  }
  for (const title of [null, 123, false, [], {}]) {
    assert.throws(() => normalizeConfig({ include: {}, title }), /title must be a string/)
  }
})

test("area queries restrict candidates and hoist shared registry helpers", () => {
  const template = query(
    [
      { area: "pool", domain: "light" },
      { area: "pool", domain: "switch" },
    ],
    { exclude: { area: "pool", state: "unavailable" } }
  )
  assert.equal(template.match(/area_entities\("pool"\)/g).length, 1)
  assert.match(template, /for entity in \(ag_members_0\)/)
  assert.doesNotMatch(template, /states \| map/)
})

test("domain queries avoid iterating all states", () => {
  const template = query({ domain: ["light", "switch"] })
  assert.match(template, /states.light/)
  assert.match(template, /states.switch/)
  assert.doesNotMatch(template, /states \| map/)
})

test("AND constraints can restrict candidates, but OR and NOT cannot", () => {
  assert.match(
    query({ all: [{ area: "pool" }, { state: "on" }] }),
    /for entity in \(ag_members_0\)/
  )
  assert.match(query({ any: [{ area: "pool" }, { domain: "light" }] }), /states \| map/)
  assert.match(query({ not: { domain: "light" } }), /states \| map/)
})

test("literal entity IDs avoid a full state scan; wildcard IDs don't", () => {
  assert.doesNotMatch(query({ entity_id: ["light.pool", "light.hall"] }), /states \| map/)
  assert.match(query({ entity_id: "light.*" }), /states \| map/)
})

test("explicit sort replaces defaults; empty sorts disable all sorting including tie-breaker", () => {
  assert.doesNotMatch(query({ domain: "light" }, { sort: { by: "state" } }), /entity_name\(/)
  assert.doesNotMatch(query({ domain: "light" }, { sort: [] }), /sort\(/)
  assert.match(query({ domain: "light" }, { sort: { by: "name" } }), /sort\(attribute='entity'\)/)
})

test("per-group cards shallowly override defaults and never enter the backend query", () => {
  const config = normalizeConfig({
    card: { name: { type: "entity" }, features: [{ type: "light-brightness" }], icon: "mdi:pool" },
    include: [
      { domain: "light", card: { type: "button", name: { type: "device" }, features: [] } },
      { domain: "switch" },
    ],
  })
  assert.deepEqual(config.query.cards[0], {
    type: "button",
    name: { type: "device" },
    features: [],
    icon: "mdi:pool",
  })
  assert.deepEqual(config.query.cards[1], {
    type: "tile",
    name: { type: "entity" },
    features: [{ type: "light-brightness" }],
    icon: "mdi:pool",
  })
  assert.doesNotMatch(config.query.template, /mdi:pool|light-brightness|button/)
})

test("validates backend matches and defensively preserves the first duplicate", () => {
  assert.deepEqual(
    normalizeMatches(
      [
        { entity: "light.pool", group: 0 },
        { entity: "light.pool", group: 1 },
      ],
      2
    ),
    [{ entity: "light.pool", group: 0 }]
  )
  for (const invalid of [
    undefined,
    "light.pool",
    ["light.pool"],
    [null],
    [{ entity: "bad", group: 0 }],
    [{ entity: "light.pool" }],
    [{ entity: "light.pool", group: -1 }],
    [{ entity: "light.pool", group: 2 }],
    [{ entity: "light.pool", group: 0.5 }],
  ]) {
    assert.throws(() => normalizeMatches(invalid, 2))
  }
})

test("hidden is a boolean rule compiled directly to HA's registry helper", () => {
  assert.match(query({ domain: "light", hidden: true }), /and is_hidden_entity\(entity\)/)
  assert.match(query({ domain: "light", hidden: false }), /and not is_hidden_entity\(entity\)/)
  assert.doesNotMatch(query({ domain: "light" }), /is_hidden_entity/)
  for (const hidden of ["false", "user", null, 0, [], [true], {}]) {
    assert.throws(() => normalizeConfig({ include: { hidden } }), /hidden must be a boolean/)
    assert.throws(
      () => normalizeConfig({ include: {}, exclude: { not: { hidden } } }),
      /hidden must be a boolean/
    )
  }
})

test("invalid configuration is rejected early", () => {
  for (const config of [
    {},
    { exclude: {} },
    { filter: {} },
    { entities: [] },
    { include: {}, options: {} },
    { include: {}, columns: 0 },
    { include: {}, columns: 1.5 },
    { include: {}, square: "false" },
    { include: {}, show_empty: "false" },
    { include: {}, card: { entity: "light.pool" } },
    { include: {}, card: { entity: null } },
    { include: {}, card: { type: 3 } },
    { include: {}, card: [] },
    { include: { domain: "light", card: { entity: "light.pool" } } },
    { include: { typo: "pool" } },
    { include: { domain: "light.*" } },
    { include: { area: [] } },
    { include: { any: {} } },
    { include: { state: {} } },
    { include: { attributes: [] } },
    { include: { state: [] } },
    { include: {}, sort: { by: "nope" } },
    { include: {}, sort: { by: "attribute" } },
    { include: {}, sort: { by: "name", reverse: "false" } },
    { include: {}, limit: -1 },
    { include: { template: "{{ [] }}" } },
    { include: {}, exclude: { card: { type: "tile" } } },
    { include: { all: [{ domain: "light", card: {} }] } },
    { include: null },
    { include: [null] },
  ])
    assert.throws(() => normalizeConfig(config), undefined, JSON.stringify(config))
})

test("quotes user input rather than interpolating Jinja source", () => {
  const text = `pool') }}{% set danger = true %}{{ ('`
  assert.ok(query({ area: text }).includes(`area_entities(${JSON.stringify(text)})`))
})

test("limits, numeric comparison, and multi-sort are compiled into the backend query", () => {
  const template = query(
    { domain: "sensor", state: "< 20" },
    { sort: [{ by: "include" }, { by: "state", numeric: true, reverse: true }], limit: 5 }
  )
  assert.match(template, /is_number\(states\(entity\)\)/)
  assert.match(template, /float\) < 20/)
  assert.match(template, /reverse=true/)
  assert.match(template, /ns.rows\[:5\]/)
  assert.ok(template.indexOf("sort(attribute='sort1'") < template.indexOf("sort(attribute='sort0'"))
})

test("card-only edits generate the exact same query for sharing subscriptions", () => {
  assert.equal(
    query({ domain: "light", card: { type: "tile" } }),
    query({ domain: "light", card: { type: "button" } })
  )
})
