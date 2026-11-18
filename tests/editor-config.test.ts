import type { AutoGridConfig } from "../src/types.ts"
import assert from "node:assert/strict"
import { test } from "node:test"
import {
  cardEditorValue,
  hasCardTemplates,
  layoutData,
  sameConfig,
  selectionData,
  updateSelection,
  updateCard,
  updateLayout,
} from "../src/editor-config.ts"

const config = {
  type: "custom:auto-grid",
  include: [{ type: "light", card: { icon: "mdi:lamp" } }],
  exclude: { hidden: true },
  group: "area",
  sort: ["group", "name"],
  card: { name: { type: "entity" }, primary: "{{ entity_name(entity) }}" },
  styler: { preset: "compact" },
  visibility: [{ condition: "user", users: ["abc"] }],
} satisfies AutoGridConfig

test("editor card values inject type and temporary entity without mutating config", () => {
  const before = structuredClone(config)
  const value = cardEditorValue(config, "light.preview")
  assert.equal(value.type, "tile")
  assert.equal(value.entity, "light.preview")
  const name = value.name as { type: string }
  name.type = "device"
  assert.deepEqual(config, before)
  assert.equal(updateCard(config, cardEditorValue(config, "light.preview"), true), config)
  assert.equal(
    updateCard({ include: {} }, { type: "tile", entity: "light.preview" }, true).card,
    undefined
  )
})

test("visual updates change only the global card and never save preview entities", () => {
  const next = updateCard(
    config,
    {
      type: "tile",
      entity: "light.preview",
      icon: "mdi:lightbulb",
      primary: "{{ entity_name(entity) }}",
    },
    true
  )
  assert.ok(next.card)
  assert.equal(next.card.icon, "mdi:lightbulb")
  assert.equal(next.card.entity, undefined)
  assert.equal(next.card.primary, "{{ entity_name(entity) }}")
  for (const key of ["include", "exclude", "group", "sort", "styler", "visibility"] as const)
    assert.deepEqual(next[key], config[key])
  assert.ok(Array.isArray(next.include) && next.include[0].card)
  next.include[0].card.icon = "changed"
  assert.equal(config.include[0].card.icon, "mdi:lamp")
})

test("card YAML preserves $ templates and rejects invalid/ambiguous values", () => {
  const card = { type: "tile", tap_action: { action: "url", $url_path: "{{ entity }}" } }
  assert.deepEqual(updateCard(config, card).card, card)
  for (const value of [
    null,
    [],
    "tile",
    1,
    { entity: "light.fixed" },
    { $entity: "{{ entity }}" },
    { name: "a", $name: "b" },
    { $icon: 2 },
  ]) {
    assert.throws(() => updateCard(config, value))
  }
  assert.equal(hasCardTemplates({ primary: "{{ entity }}" }), false)
  assert.equal(hasCardTemplates({ card: [{ tap_action: { $url_path: "URL" } }] }), true)
  assert.equal(hasCardTemplates({ $type: "tile" }), true)
})

test("layout edits preserve queries and avoid materializing unrelated defaults", () => {
  assert.deepEqual(layoutData(config), {
    columns: "2",
    square: false,
    show_empty: false,
  })
  assert.equal(updateLayout(config, layoutData(config)), config)
  const next = updateLayout(config, { square: true })
  assert.equal(next.columns, undefined)
  assert.equal(next.square, true)
  assert.equal(next.show_empty, undefined)
  assert.deepEqual(next.card, config.card)
  assert.deepEqual(next.include, config.include)
  assert.equal(updateLayout(config, { columns: "auto" }).columns, "auto")
  assert.equal(updateLayout(config, { columns: "all" }).columns, "all")
  assert.equal(updateLayout(config, { columns: "180px" }).columns, "180px")
  assert.equal(updateLayout(config, { columns: "4" }).columns, 4)
  assert.equal(updateLayout(config, { columns: 4 }).columns, 4)
  assert.equal(updateLayout(config, { square: true }).square, true)
  assert.equal(updateLayout(config, { show_empty: true }).show_empty, true)
  assert.equal(updateLayout({ ...config, columns: 5 }, { columns: "" }).columns, undefined)
  for (const columns of [
    "0",
    "-1",
    "1.5",
    "25",
    "180",
    "0px",
    "1rem",
    "fill",
    "NaN",
    false,
    [],
    {},
  ])
    assert.throws(() => updateLayout(config, { columns }))
  assert.throws(() => updateLayout(config, { square: "true" }))
  assert.throws(() => updateLayout(config, { show_empty: null }))
  assert.equal(sameConfig({ b: 1, a: { d: 2, c: 3 } }, { a: { c: 3, d: 2 }, b: 1 }), true)
})

test("selection YAML owns only query fields, preserving card/layout/extra root options", () => {
  const original = {
    ...structuredClone(config),
    title: "Office",
    columns: "auto",
    limit: 5,
  } satisfies AutoGridConfig
  const data = selectionData(original)
  assert.deepEqual(Object.keys(data), ["include", "exclude", "group", "sort", "limit"])
  assert.equal(updateSelection(original, data), original)
  const includes = data.include as typeof config.include
  includes[0].card.icon = "changed"
  assert.equal(original.include[0].card.icon, "mdi:lamp")
  const next = updateSelection(original, { include: config.include, sort: "name", limit: 2 })
  assert.deepEqual(next.include, config.include)
  assert.equal(next.sort, "name")
  assert.equal(next.limit, 2)
  assert.equal("exclude" in next, false)
  assert.equal("group" in next, false)
  for (const key of ["card", "title", "columns", "styler", "visibility"] as const)
    assert.deepEqual(next[key], original[key])
  const noLimit = updateSelection(next, { include: config.include })
  assert.equal("limit" in noLimit, false)
  assert.equal("sort" in noLimit, false)
  assert.deepEqual(selectionData(original).include, config.include)
})

test("selection YAML validates its complete selection before replacing saved fields", () => {
  for (const value of [
    null,
    [],
    "",
    {},
    { include: {}, card: {} },
    { include: {}, title: "oops" },
    { include: { wat: true } },
    { include: {}, sort: "bogus" },
    { include: {}, group: "bogus" },
    { include: {}, limit: -1 },
  ]) {
    assert.throws(() => updateSelection(config, value))
  }
  assert.equal(updateSelection(config, selectionData(config)), config)
})
