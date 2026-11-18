import assert from "node:assert/strict"
import { test } from "node:test"
import { normalizeConfig } from "./helpers.ts"
import type { Filter, FilterField } from "../src/types.ts"

test("filter types expose only canonical keys", () => {
  const canonicalOnly: Extract<keyof Filter | FilterField, "entity_id" | "or" | "and"> extends never
    ? true
    : false = true
  assert.equal(canonicalOnly, true)
})

test("entity is canonical for filters, sorting, grouping, and native lists", () => {
  const config = normalizeConfig({
    include: { entity: ["light.b", "light.a"] },
    sort: "entity",
    group: "entity",
  })
  assert.deepEqual(config.warnings, [])
  assert.equal(config.query.group?.by, "entity")
  assert.match(config.query.template, /for entity in \(\["light.b","light.a"\]\)/)
  for (const extra of [{ sort: "entity_id" }, { group: "entity_id" }])
    assert.throws(() => normalizeConfig({ include: {}, ...extra }))
})

test("entity_id aliases normalize on a clone with stable, path-specific warnings", () => {
  const input = {
    include: [
      { entity_id: "light.a" },
      { all: [{ any: [{ entity_id: "light.*" }] }], not: { entity_id: "light.b" } },
    ],
    exclude: { not: [{ entity_id: "light.c" }] },
    sort: [],
  }
  const before = structuredClone(input)
  const normalized = normalizeConfig(input)
  assert.deepEqual(
    normalized.warnings.map(({ path }) => path),
    [
      "include[0].entity_id",
      "include[1].all[0].any[0].entity_id",
      "include[1].not.entity_id",
      "exclude[0].not[0].entity_id",
    ]
  )
  assert.ok(normalized.warnings.every(({ code }) => code === "filter-entity-id-alias"))
  assert.deepEqual(normalizeConfig(input).warnings, normalized.warnings)
  assert.deepEqual(input, before)
  const canonical = JSON.parse(
    JSON.stringify(input).replaceAll('"entity_id":', '"entity":')
  ) as unknown
  assert.deepEqual(normalizeConfig(canonical).query, normalized.query)
  assert.deepEqual(normalizeConfig(canonical).warnings, [])
})

test("only unambiguous entity aliases recover; unknown filters remain errors", () => {
  assert.equal(
    normalizeConfig({ include: { entity: "light.a", entity_id: ["light.a"] } }).warnings.length,
    1
  )
  assert.throws(
    () => normalizeConfig({ include: { entity: "light.a", entity_id: "light.b" } }),
    /conflicting entity/
  )
  assert.throws(
    () => normalizeConfig({ include: { domin: "light" } }),
    /Unknown filter rule: domin/
  )
  assert.throws(
    () => normalizeConfig({ include: {}, group: { title: "Old" } }),
    /use group.heading/
  )
  assert.deepEqual(normalizeConfig({ include: {}, card: { custom_option: true } }).warnings, [])
})

test("boolean aliases normalize recursively with warnings referring to the original paths", () => {
  const input = {
    include: { and: [{ domain: "light" }, { or: [{ entity_id: "light.a" }, { state: "on" }] }] },
    exclude: { not: { or: [{ and: [{ hidden: true }, { entity_id: "light.b" }] }] } },
  }
  const before = structuredClone(input)
  const canonical = {
    include: { all: [{ domain: "light" }, { any: [{ entity: "light.a" }, { state: "on" }] }] },
    exclude: { not: { any: [{ all: [{ hidden: true }, { entity: "light.b" }] }] } },
  }
  const normalized = normalizeConfig(input)
  assert.deepEqual(normalized.query, normalizeConfig(canonical).query)
  assert.deepEqual(
    normalized.warnings.map(({ code, path }) => ({ code, path })),
    [
      { code: "filter-and-alias", path: "include[0].and" },
      { code: "filter-or-alias", path: "include[0].and[1].or" },
      { code: "filter-entity-id-alias", path: "include[0].and[1].or[0].entity_id" },
      { code: "filter-or-alias", path: "exclude[0].not.or" },
      { code: "filter-and-alias", path: "exclude[0].not.or[0].and" },
      { code: "filter-entity-id-alias", path: "exclude[0].not.or[0].and[1].entity_id" },
    ]
  )
  assert.deepEqual(input, before)
  assert.deepEqual(normalizeConfig(canonical).warnings, [])
})

test("boolean aliases reject conflicts and malformed rules without silently broadening selection", () => {
  for (const [alias, target] of [
    ["or", "any"],
    ["and", "all"],
  ]) {
    const children = [{ domain: "light" }]
    assert.equal(
      normalizeConfig({ include: { [alias]: children, [target]: children } }).warnings.length,
      1
    )
    assert.throws(
      () => normalizeConfig({ include: { [alias]: children, [target]: [{ domain: "sensor" }] } }),
      /conflicting/
    )
    for (const value of [null, false, {}, "light", [null], [{ domin: "light" }]])
      assert.throws(() => normalizeConfig({ include: { [alias]: value } }))
    assert.equal(
      normalizeConfig({ include: { [alias]: [] } }).query.template,
      normalizeConfig({ include: { [target]: [] } }).query.template
    )
    assert.throws(() => normalizeConfig({ include: {}, sort: alias }))
    assert.throws(() => normalizeConfig({ include: {}, group: alias }))
  }
})
