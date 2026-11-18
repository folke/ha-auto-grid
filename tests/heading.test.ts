import type { AutoGridConfig, HeadingConfig } from "../src/types.ts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { GridController } from "../src/grid.ts"
import { normalizeConfig, rendered, testCard, testConnection } from "./helpers.ts"
import { compileHeadingOptions, headingConfig, visibleHeading } from "../src/heading.ts"
import {
  headingEditorValue,
  updateHeading,
  updateLayout,
  selectionData,
  updateSelection,
} from "../src/editor-config.ts"

const base = {
  include: { type: "light" },
  card: { type: "tile" },
  columns: 2,
} satisfies AutoGridConfig

test("heading shorthand and legacy title normalize to native cards without changing selection", () => {
  const plain = normalizeConfig(base)
  assert.equal(plain.heading, undefined)
  const expected = { type: "heading", heading_style: "title", heading: "Office" }
  for (const input of [
    { heading: "Office" },
    { title: "Office" },
    { heading: { heading: "Office" } },
  ]) {
    const normalized = normalizeConfig({ ...base, ...input })
    assert.deepEqual(normalized.heading, expected)
    assert.deepEqual(normalized.query, plain.query)
  }
  const heading: HeadingConfig = {
    heading: "Office",
    icon: "mdi:desk",
    tap_action: { action: "navigate", navigation_path: "/office" },
    badges: [{ type: "entity", entity: "sensor.office_temperature" }],
  }
  const normalized = normalizeConfig({ ...base, heading })
  assert.deepEqual(normalized.heading, { type: "heading", heading_style: "title", ...heading })
  assert.equal(heading.type, undefined)
  assert.equal(visibleHeading(normalized.heading), true)
  assert.equal(visibleHeading(headingConfig({ heading: "" })), false)
  assert.equal(visibleHeading(headingConfig({ heading: {} })), false)
  assert.equal(visibleHeading(headingConfig({ heading: { icon: "mdi:desk" } })), true)
  assert.equal(visibleHeading(headingConfig({ heading: { badges: heading.badges } })), true)
})

test("heading shorthand and object text share implicit templating; other options remain explicit", () => {
  const source = "{{ states('sensor.count') }}"
  const plans = [
    headingConfig({ heading: source })!,
    headingConfig({ heading: { heading: source } })!,
    headingConfig({ heading: { $heading: source } })!,
  ].map(compileHeadingOptions)
  plans.forEach((plan) => assert.deepEqual(plan, plans[0]))
  assert.equal(compileHeadingOptions(headingConfig({ heading: "Literal" })!).templates.length, 0)
  const heading = headingConfig({
    heading: { heading: "Static", icon: source, $heading_style: "{{ 'subtitle' }}" },
  })!
  assert.equal(heading.heading_style, undefined)
  const plan = compileHeadingOptions(heading)
  assert.equal(plan.card.icon, source)
  assert.deepEqual(plan.templates, [{ path: ["heading_style"], source: "{{ 'subtitle' }}" }])
})

test("invalid headings and ambiguous title/heading configuration are rejected", () => {
  assert.throws(() => normalizeConfig({ ...base, title: "Old", heading: "New" }), /not both/)
  for (const heading of [
    null,
    1,
    true,
    [],
    { type: "tile" },
    { entity: "light.fixed" },
    { heading: "Text", $heading: "{{ entity }}" },
    { heading: true },
    { icon: 1 },
    { heading_style: "large" },
    { badges: "sensor.test" },
  ]) {
    assert.throws(() => normalizeConfig({ ...base, heading }))
  }
  assert.equal(
    normalizeConfig({ ...base, heading: { heading_style: "subtitle", heading: "Small" } }).heading!
      .heading_style,
    "subtitle"
  )
})

test("heading editor preserves native options, migrates title only on edits, and can disable heading", () => {
  const config = {
    ...structuredClone(base),
    title: "Office",
    group: "area",
    styler: { preset: "compact" },
  } satisfies AutoGridConfig
  const before = structuredClone(config)
  const value = headingEditorValue(config)
  assert.equal(updateHeading(config, value), config)
  const edited = updateHeading(config, {
    ...value,
    icon: "mdi:desk",
    badges: [{ type: "entity", entity: "sensor.office_temperature" }],
  })
  assert.equal(edited.title, undefined)
  assert.ok(edited.heading && typeof edited.heading !== "string")
  assert.equal(edited.heading.heading, "Office")
  assert.equal(edited.heading.type, undefined)
  assert.equal(edited.heading.icon, "mdi:desk")
  for (const key of ["include", "card", "columns", "group", "styler"] as const)
    assert.deepEqual(edited[key], config[key])
  assert.deepEqual(config, before)
  const disabled = updateHeading(edited, undefined)
  assert.equal(disabled.heading, undefined)
  assert.equal(disabled.title, undefined)
  const enabled = updateHeading(base, { type: "heading", heading_style: "title", heading: "" })
  assert.equal(enabled, base)
  assert.deepEqual(updateLayout(edited, { columns: "auto" }).heading, edited.heading)
  assert.deepEqual(updateSelection(edited, selectionData(edited)).heading, edited.heading)
  for (const invalid of [null, [], "Heading", { entity: "light.fixed" }, { $heading: 3 }])
    assert.throws(() => updateHeading(config, invalid))
})

test("empty native heading initialization is a no-op; clearing text preserves icons and badges", () => {
  for (const value of [
    { type: "heading" },
    { type: "heading", heading_style: "title", heading: "" },
  ])
    assert.equal(updateHeading(base, value), base)
  const cleared = updateHeading({ ...base, heading: "Office" }, { type: "heading", heading: "" })
  assert.equal(cleared.heading, undefined)
  assert.equal(cleared.title, undefined)
  const icon = updateHeading(base, { type: "heading", heading: "", icon: "mdi:desk" })
  assert.equal(visibleHeading(headingConfig(icon)), true)
  const badges = updateHeading(base, {
    type: "heading",
    heading: "",
    badges: [{ type: "entity", entity: "sensor.test" }],
  })
  assert.equal(visibleHeading(headingConfig(badges)), true)
})

test("main heading query renders independently with static config and escaped string results", () => {
  const python = spawnSync("python3", ["-c", "import jinja2"])
  if (python.status !== 0) return
  const requests: Record<string, unknown>[] = []
  const grid = new GridController(
    async (card) => testCard(card),
    () => {}
  )
  const connection = testConnection({
    subscribeMessage(_callback: unknown, request: Record<string, unknown>) {
      if (request.type === "render_template") requests.push(request)
      return Promise.resolve(() => {})
    },
  })
  grid.configure(
    normalizeConfig({
      include: [],
      heading: {
        heading: "{{ states('sensor.weather') }} / {{ config.get('entity', 'unset') }}",
        $icon: "{{ 'mdi:' ~ states('sensor.icon') }}",
        target: "sensor.weather",
        badges: [{ type: "entity", $entity: "{{ config.target }}" }],
      },
    })
  )
  grid.setHass({ connection, states: {} })
  grid.connect()
  const request = requests[0]
  assert.match(request.template as string, /ag_heading_0/)
  const output = spawnSync(
    "python3",
    [fileURLToPath(new URL("render-template.py", import.meta.url))],
    {
      encoding: "utf8",
      input: JSON.stringify([
        {
          template: request.template,
          variables: request.variables,
          states: {
            "sensor.weather": { state: 'Snow "storm"\nAlert' },
            "sensor.icon": { state: "snowflake" },
          },
        },
      ]),
    }
  )
  grid.disconnect()
  assert.equal(output.status, 0, output.stderr)
  assert.deepEqual(rendered<string[]>(output.stdout)[0].result, [
    'Snow "storm"\nAlert / unset',
    "mdi:snowflake",
    "sensor.weather",
  ])
})
