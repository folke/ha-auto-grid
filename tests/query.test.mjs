import assert from "node:assert/strict"
import { test } from "node:test"
import { fieldValue, normalizeConfig, normalizeMatches } from "../src/query.ts"

const query = (include, extra = {}) => normalizeConfig({ include, ...extra }).query.template

test("defaults to two columns of tiles and name sorting without mutating input", () => {
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

test("columns accepts positive integers or auto without changing backend queries", () => {
  const base = normalizeConfig({ include: { type: "light" } })
  for (const columns of [1, 2, 6, "auto"]) {
    const config = normalizeConfig({ include: { type: "light" }, columns })
    assert.equal(config.columns, columns)
    assert.deepEqual(config.query, base.query)
  }
  for (const columns of [0, -1, 1.5, "0", "2", "fill", "AUTO", "", null, false, [], {}, Infinity]) {
    assert.throws(() => normalizeConfig({ include: {}, columns }), /columns must be/)
  }
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

test("sort strings and mixed lists compile identically to their expanded forms", () => {
  const include = { domain: "sensor" }
  for (const by of [
    "group",
    "entity_id",
    "name",
    "state",
    "last_changed",
    "last_updated",
    "integration",
    "area",
    "floor",
    "device",
    "label",
    "domain",
    "type",
    "hidden",
    "attr.battery",
    "attr.some.integration_key",
  ]) {
    assert.equal(query(include, { sort: by }), query(include, { sort: { by } }))
  }
  assert.equal(query(include, { sort: "name" }), query(include))
  assert.equal(
    query(include, { sort: ["group", { by: "attr.battery", numeric: true }, "name"] }),
    query(include, {
      sort: [{ by: "group" }, { by: "attr.battery", numeric: true }, { by: "name" }],
    })
  )
  for (const sort of [
    "",
    "nope",
    "attribute",
    "attr.",
    null,
    3,
    [false],
    [["name"]],
    { by: "attr.", numeric: true },
    { by: "name", attribute: "battery" },
  ]) {
    assert.throws(() => normalizeConfig({ include, sort }))
  }
})

test("fieldValue supplies every sortable filter field and optional by defaults to name", () => {
  const fields = [
    "area",
    "floor",
    "device",
    "label",
    "domain",
    "entity_id",
    "type",
    "hidden",
    "state",
    "name",
    "last_changed",
    "last_updated",
    "integration",
    "attr.battery",
  ]
  for (const field of fields) {
    assert.ok(query({ domain: "sensor" }, { sort: field }).includes(fieldValue(field, 0)), field)
  }
  assert.equal(fieldValue("group", 12), "ag_groups[12]")
  assert.equal(query({}, { sort: {} }), query({}, { sort: "name" }))
  assert.equal(
    query({}, { sort: { reverse: true } }),
    query({}, { sort: { by: "name", reverse: true } })
  )
  for (const field of ["all", "any", "not", "category", "entity_category", "attr."]) {
    assert.throws(() => normalizeConfig({ include: {}, sort: field }), /Unknown sort.by/)
  }
})

test("integration candidates and predicates share one hoisted membership lookup", () => {
  const template = query(
    { integration: "mqtt" },
    { exclude: { integration: "mqtt", hidden: true } }
  )
  assert.equal(template.match(/integration_entities\("mqtt"\)/g).length, 1)
  assert.doesNotMatch(template, /states \| map/)
  assert.match(template, /for entity in \(ag_members_0\)/)
  assert.doesNotMatch(query({ not: { integration: "mqtt" } }), /for entity in \(ag_members_0\)/)
})

test("timestamp rules use the same Unix timestamp expressions as sorting", () => {
  for (const field of ["last_changed", "last_updated"]) {
    assert.ok(query({ [field]: "> 1767225600" }).includes(fieldValue(field, 0)))
    assert.throws(() => normalizeConfig({ include: { [field]: {} } }))
  }
  for (const integration of [null, 3, [], [null], {}]) {
    assert.throws(() => normalizeConfig({ include: { integration } }))
  }
  assert.throws(() => normalizeConfig({ include: { category: "diagnostic" } }), /Unknown filter/)
})

test("attribute filter names are literal, quoted, and non-empty", () => {
  for (const attribute of [
    "battery",
    "some.integration_key",
    "battery:level",
    "name') }} {{ danger",
  ]) {
    assert.ok(
      query({ [`attr.${attribute}`]: true }).includes(
        `state_attr(entity, ${JSON.stringify(attribute)})`
      )
    )
  }
  assert.throws(() => normalizeConfig({ include: { device_class: "battery" } }), /Unknown filter/)
  assert.throws(() => normalizeConfig({ include: {}, sort: "device_class" }), /Unknown sort/)
  for (const filter of [
    { "attr.": true },
    { "attr.level": {} },
    { "attr.level": [] },
    { attributes: {} },
  ]) {
    assert.throws(() => normalizeConfig({ include: filter }))
  }
})

test("not accepts a filter or list, rejecting malformed nested rules", () => {
  for (const not of [
    { hidden: true },
    [{ hidden: true }, { state: "unavailable" }],
    [],
    [{ not: [{ hidden: true }] }],
  ]) {
    assert.doesNotThrow(() => normalizeConfig({ include: { not } }))
  }
  for (const not of [null, "hidden", [null], ["hidden"], [[{}]], [{ card: {} }]]) {
    assert.throws(() => normalizeConfig({ include: { not } }))
  }
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
    { sort: [{ by: "group" }, { by: "state", numeric: true, reverse: true }], limit: 5 }
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
