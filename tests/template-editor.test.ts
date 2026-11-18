import assert from "node:assert/strict"
import { test } from "node:test"
import { mergeVisualEdit, restoreTemplateValues, templateEditorInfo } from "../src/editor-config.ts"
import type { CardConfig } from "../src/types.ts"

const source = {
  type: "tile",
  $name: "{{ entity }}",
  icon: "mdi:home",
  tap_action: { action: "url", $url_path: "{{ '/entity/' ~ entity }}" },
  custom_option: "preserved",
}
const snapshot = {
  type: "tile",
  entity: "light.a",
  name: "Rendered",
  icon: "mdi:home",
  tap_action: { action: "url", url_path: "/entity/light.a" },
}

test("visual edits merge only changed static options into template sources", () => {
  const before = structuredClone(source)
  assert.deepEqual(mergeVisualEdit(source, snapshot, snapshot).card, source)
  const result = mergeVisualEdit(source, snapshot, {
    ...snapshot,
    icon: "mdi:pool",
    name: "Attempted",
    tap_action: { action: "navigate", url_path: "/attempted" },
  })
  assert.deepEqual(result.card, {
    ...source,
    icon: "mdi:pool",
    tap_action: { action: "navigate", $url_path: source.tap_action.$url_path },
  })
  assert.deepEqual(result.protectedEdits, ["name", "tap_action.url_path"])
  assert.deepEqual(source, before)
  assert.equal(Object.hasOwn(result.card, "entity"), false)
})

test("initialization defaults in the snapshot are not materialized by later edits", () => {
  const initialized = { ...snapshot, vertical: false }
  const result = mergeVisualEdit(source, initialized, { ...initialized, icon: "mdi:pool" })
  assert.equal(result.card.vertical, undefined)
  assert.equal(result.card.icon, "mdi:pool")
  const cleared = mergeVisualEdit(source, snapshot, { ...snapshot, icon: undefined })
  assert.equal(cleared.card.icon, undefined)
})

test("template-controlled values are restored for native editor feedback", () => {
  const restored = restoreTemplateValues(source, snapshot, {
    ...snapshot,
    name: "Attempted",
    tap_action: { action: "url", url_path: "/attempted" },
  })
  assert.equal(restored.name, "Rendered")
  assert.deepEqual(restored.tap_action, snapshot.tap_action)
  assert.equal(Object.hasOwn(restored, "$name"), false)
})

test("templated arrays and card types require YAML; structural changes are rejected", () => {
  assert.deepEqual(templateEditorInfo(source), {
    paths: ["name", "tap_action.url_path"],
    safe: true,
  })
  assert.equal(templateEditorInfo({ $type: "{{ 'tile' }}" }).safe, false)
  assert.equal(templateEditorInfo({ features: [{ $label: "{{ entity }}" }] }).safe, false)
  assert.throws(() => mergeVisualEdit(source, snapshot, { type: "button" }), /requires YAML/)
  assert.throws(
    () => mergeVisualEdit(source, snapshot, { ...snapshot, tap_action: [] }),
    /requires YAML/
  )
  const { tap_action: _removed, ...withoutAction } = snapshot
  assert.throws(() => mergeVisualEdit(source, snapshot, withoutAction), /requires YAML/)
  assert.deepEqual(
    mergeVisualEdit(
      { type: "tile", features: [] },
      { type: "tile", features: [] },
      { type: "tile", features: [{ type: "toggle" }] }
    ).card.features,
    [{ type: "toggle" }]
  )
})

test("restoring template paths cannot write through inherited prototype properties", () => {
  const original = JSON.parse(
    '{"type":"tile","__proto__":{"$auto_card_test":"source"}}'
  ) as CardConfig
  const rendered = JSON.parse(
    '{"type":"tile","__proto__":{"auto_card_test":"rendered"}}'
  ) as CardConfig
  const restored = restoreTemplateValues(original, rendered, { type: "tile" })
  assert.equal(Object.hasOwn(restored, "__proto__"), true)
  assert.deepEqual(restored.__proto__, { auto_card_test: "rendered" })
  assert.equal(Object.hasOwn(Object.prototype, "auto_card_test"), false)
})
