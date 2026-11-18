import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { normalizeResult } from "../src/query.ts"
import { renderCardOptions } from "../src/card-templates.ts"
import { normalizeConfig, rendered } from "./helpers.ts"

const python = spawnSync("python3", ["-c", "import jinja2"])
test(
  "batched selection renders native option types and typed group headings end to end",
  { skip: python.status !== 0 },
  () => {
    const states = {
      "light.a": { state: "on", attributes: { count: 7 } },
      "light.b": { state: "off", attributes: { count: 0 } },
    }
    const config = normalizeConfig({
      include: { entity: Object.keys(states) },
      sort: "entity",
      card: {
        type: "custom:typed-card",
        $enabled: "{{ is_state(entity, 'on') }}",
        $count: "{{ state_attr(entity, 'count') }}",
        $features: "{{ [{'type': 'toggle', 'enabled': true}] }}",
        $options: "{{ {'missing': none, 'strings': ['123', 'True', '[1]']} }}",
        $text: "{{ state_attr(entity, 'count') | string | to_json }}",
        literal: "123",
      },
      group: {
        by: "entity",
        heading: {
          $heading: "{{ state_attr(entity, 'count') | string | to_json }}",
          $badges: "{{ [{'type': 'entity', 'entity': entity}] }}",
        },
      },
    })
    const output = spawnSync(
      "python3",
      [fileURLToPath(new URL("render-template.py", import.meta.url))],
      {
        encoding: "utf8",
        input: JSON.stringify([{ states, template: config.query.template }]),
      }
    )
    assert.equal(output.status, 0, output.stderr)
    const result = normalizeResult(rendered<unknown>(output.stdout)[0].result, config)
    const cards = result.matches.map((match) =>
      renderCardOptions(
        config.query.cards[match.group],
        config.query.templates[match.group],
        match.values,
        match.entity
      )
    )
    assert.deepEqual(
      cards.map(({ enabled, count, text }) => ({ enabled, count, text })),
      [
        { enabled: true, count: 7, text: "7" },
        { enabled: false, count: 0, text: "0" },
      ]
    )
    assert.deepEqual(cards[0].features, [{ type: "toggle", enabled: true }])
    assert.deepEqual(cards[0].options, { missing: null, strings: ["123", "True", "[1]"] })
    assert.equal(cards[0].literal, "123")
    assert.deepEqual(
      result.sections!.map(({ title, heading }) => ({
        title,
        text: heading.heading,
        badges: heading.badges,
      })),
      [
        { title: "7", text: "7", badges: [{ type: "entity", entity: "light.a" }] },
        { title: "0", text: "0", badges: [{ type: "entity", entity: "light.b" }] },
      ]
    )
  }
)
