import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { normalizeConfig, normalizeResult } from "../src/query.ts"
import { renderCardOptions } from "../src/card-templates.ts"

const compile = (card, extra = {}) =>
  normalizeConfig({ include: { type: "update" }, card, ...extra })
const render = (config, row) =>
  renderCardOptions(
    config.query.cards[row.group],
    config.query.templates[row.group],
    row.values,
    row.entity
  )

test("only $ keys opt into templating, with nested objects and array paths", () => {
  const input = {
    type: "custom:mushroom-template-card",
    primary: "{{ entity }}",
    tap_action: { action: "url", $url_path: "{{ entity }}" },
    features: [{ $label: "{{ area }}" }],
  }
  const before = structuredClone(input)
  const config = compile(input)
  assert.deepEqual(
    config.query.templates[0].map(({ path }) => path),
    [
      ["tap_action", "url_path"],
      ["features", 0, "label"],
    ]
  )
  const card = render(config, {
    entity: "update.good",
    group: 0,
    values: ["https://example.com", "Office"],
  })
  assert.equal(card.primary, "{{ entity }}")
  assert.equal(card.tap_action.url_path, "https://example.com")
  assert.equal(card.features[0].label, "Office")
  assert.equal(card.entity, "update.good")
  assert.deepEqual(input, before)
  assert.equal(config.query.cards[0].tap_action.url_path, "")
  assert.equal(compile({ primary: "{{ entity }}" }).query.templates[0].length, 0)
  assert.doesNotMatch(compile({ primary: "{{ entity }}" }).query.template, /primary/)
})

test("template validation rejects ambiguous keys, non-string values, and entity overrides", () => {
  for (const card of [
    { name: "A", $name: "B" },
    { tap_action: { url_path: "a", $url_path: "b" } },
    { features: [{ label: "a", $label: "b" }] },
    { $entity: "update.good" },
    { $name: null },
    { $name: 1 },
    { $name: true },
    { $name: {} },
    { $name: [] },
    { $: "a" },
    { $$name: "a" },
  ])
    assert.throws(() => compile(card), undefined, JSON.stringify(card))
  assert.throws(() => compile({}, { include: { card: { name: "a", $name: "b" } } }))
})

test("include overrides merge by destination key, while nested configuration remains shallow", () => {
  const config = compile(
    { name: "Static", tap_action: { action: "more-info" } },
    {
      include: {
        type: "update",
        card: { $name: "{{ entity }}", tap_action: { $url_path: "URL" } },
      },
    }
  )
  const card = render(config, {
    entity: "update.good",
    group: 0,
    values: config.query.templates[0].map(({ path }) =>
      path.at(-1) === "name" ? "Dynamic" : "URL"
    ),
  })
  assert.equal(card.name, "Dynamic")
  assert.deepEqual(card.tap_action, { url_path: "URL" })
  const reverse = compile(
    { $name: "{{ entity }}" },
    { include: { type: "update", card: { name: "Static" } } }
  )
  assert.equal(reverse.query.templates[0].length, 0)
  assert.equal(reverse.query.cards[0].name, "Static")
  const dynamicType = compile({ $type: "tile" })
  assert.equal(
    render(dynamicType, { entity: "update.good", group: 0, values: ["tile"] }).type,
    "tile"
  )
  assert.throws(
    () => render(dynamicType, { entity: "update.good", group: 0, values: [""] }),
    /card.type/
  )
  for (const values of [undefined, [], [123, "b"], ["a", "b", "c"]])
    assert.throws(() => render(config, { entity: "update.good", group: 0, values }))
})

const python = spawnSync("python3", ["-c", "import jinja2"], { encoding: "utf8" })
test(
  "explicit options render after selection/limits, with isolated static and grouping context",
  {
    skip: python.status !== 0 ? "Optional check requires Python 3 with jinja2 installed" : false,
  },
  () => {
    const states = {
      "update.wud_dockge": {
        state: "on",
        name: "A",
        attributes: { stack: "hello world", watcher: "dockge" },
      },
      "update.wud_servarr": {
        state: "on",
        name: "B",
        attributes: { stack: "media", watcher: "servarr" },
      },
      "update.wud_frigate": {
        state: "on",
        name: "C",
        attributes: { stack: "camera", watcher: "frigate" },
      },
      "update.wud_bad": { state: "on", name: "Z", attributes: { stack: "other", watcher: "bad" } },
    }
    const include = {
      type: "update",
      entity_id: "update.wud_*",
      state: "on",
      "attr.watcher": ["dockge", "servarr", "frigate"],
      "attr.stack": "/.+/",
    }
    const url = `{% set watcher = state_attr(entity, 'watcher') %}
{% set base = 'https://servarr.folke.io' if watcher == 'servarr' else 'https://dockge.folke.io' %}
{% set suffix = '/10.0.0.6:5001' if watcher == 'frigate' else '' %}
{{ base }}/compose/{{ state_attr(entity, 'stack') | urlencode }}{{ suffix }}`
    const configs = [
      normalizeConfig({ include, card: { tap_action: { action: "url", $url_path: url } } }),
      normalizeConfig({
        include: { entity_id: "update.wud_dockge" },
        card: {
          type: "custom:mushroom-template-card",
          area: "office",
          enabled: true,
          empty: null,
          primary: "{{ entity_name(entity) }}",
          $secondary:
            "{{ entity }}|{{ config.entity }}|{{ area }}|{{ config.area }}|{{ config.enabled }}|{{ config.empty is none }}|{{ config.primary }}",
        },
      }),
      normalizeConfig({
        include,
        group: "attr.watcher",
        card: { $name: "{{ group }}/{{ group_name }}/{{ group_count }}/{{ entity }}" },
      }),
      normalizeConfig({
        include: { entity_id: "update.wud_dockge" },
        card: { $area: "office", $name: "{{ area is none }}/{{ 'area' not in config }}" },
      }),
      normalizeConfig({
        include: { type: "update" },
        limit: 1,
        card: { $name: "{% if entity.endswith('_bad') %}{{ 1 / 0 }}{% else %}Good{% endif %}" },
      }),
      normalizeConfig({ include: { type: "update" }, limit: 0, card: { $name: "{{ 1 / 0 }}" } }),
      normalizeConfig({
        include: [{ type: "update" }, { type: "update", card: { $name: "{{ 1 / 0 }}" } }],
      }),
      normalizeConfig({
        include: { type: "update" },
        exclude: { entity_id: "update.wud_bad" },
        card: { $name: "{% if entity.endswith('_bad') %}{{ 1 / 0 }}{% else %}Good{% endif %}" },
      }),
      normalizeConfig({
        include: [{ type: "update", card: { $name: "{{ entity }}" } }, { type: "light" }],
      }),
    ]
    const output = spawnSync(
      "python3",
      [fileURLToPath(new URL("./render-template.py", import.meta.url))],
      {
        input: JSON.stringify(
          configs.map((config) => ({ states, template: config.query.template }))
        ),
        encoding: "utf8",
      }
    )
    assert.equal(output.status, 0, output.stderr)
    const results = JSON.parse(output.stdout).map((result, i) =>
      normalizeResult(result.result, configs[i])
    )
    assert.deepEqual(
      results[0].matches.map((row) => render(configs[0], row).tap_action.url_path),
      [
        "https://dockge.folke.io/compose/hello%20world",
        "https://servarr.folke.io/compose/media",
        "https://dockge.folke.io/compose/camera/10.0.0.6:5001",
      ]
    )
    assert.equal(
      render(configs[1], results[1].matches[0]).secondary,
      "update.wud_dockge|update.wud_dockge|office|office|True|True|{{ entity_name(entity) }}"
    )
    assert.deepEqual(
      results[2].matches.map((row) => render(configs[2], row).name),
      [
        "dockge/dockge/3/update.wud_dockge",
        "servarr/servarr/3/update.wud_servarr",
        "frigate/frigate/3/update.wud_frigate",
      ]
    )
    const isolated = render(configs[3], results[3].matches[0])
    assert.equal(isolated.area, "office")
    assert.equal(isolated.name, "True/True")
    assert.equal(results[4].matches.length, 1)
    assert.equal(render(configs[4], results[4].matches[0]).name, "Good")
    assert.deepEqual(results[5].matches, [])
    assert.ok(results[6].matches.every((row) => row.values === undefined))
    assert.equal(results[7].matches.length, 3)
  }
)
