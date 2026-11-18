import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { subscribeCardOptions } from "../src/standalone-templates.ts"
import { validateCardOptions } from "../src/card-templates.ts"
import { rendered, testConnection } from "./helpers.ts"
import type { Callback, Message, Request } from "./helpers.ts"
import type { CardConfig } from "../src/types.ts"

function fixture() {
  const requests: Request[] = []
  const connection = testConnection({
    subscribeMessage(callback: Callback, request: Message) {
      if (request.type === "render_template") requests.push({ callback, request })
      return Promise.resolve(() => {})
    },
  })
  const results: CardConfig[] = [],
    errors: string[] = []
  return {
    connection,
    requests,
    results,
    errors,
    consumer: {
      result: (config: CardConfig) => {
        results.push(config)
      },
      error: (error: Error) => {
        errors.push(error.message)
      },
    },
  }
}

test("standalone cards allow entity options without weakening grid validation", () => {
  for (const card of [
    { type: "tile", entity: "light.a" },
    { type: "tile", $entity: "{{ config.target }}" },
  ]) {
    assert.doesNotThrow(() => validateCardOptions(card, false))
    assert.throws(() => validateCardOptions(card), /supplied by the query/)
  }
  assert.throws(
    () => validateCardOptions({ entity: "light.a", $entity: "light.b" }, false),
    /Conflicting/
  )
})

test("static standalone cards need no subscription and do not inject an entity", () => {
  const f = fixture()
  const card = { type: "markdown", content: "Hello" }
  assert.equal(subscribeCardOptions(f.connection, card, f.consumer), undefined)
  assert.deepEqual(f.results, [card])
  assert.equal(Object.hasOwn(f.results[0], "entity"), false)
  assert.equal(f.requests.length, 0)
})

test("standalone context exposes only static config and entity; results preserve native types", () => {
  const f = fixture()
  const card = {
    type: "tile",
    entity: "light.a",
    area: "office",
    device: "lamp",
    $name: "{{ entity }}",
    tap_action: { action: "url", $url_path: "{{ config.area }}" },
  }
  const stop = subscribeCardOptions(f.connection, card, f.consumer)!
  assert.deepEqual(f.requests[0].request.variables, {
    config: {
      type: "tile",
      entity: "light.a",
      area: "office",
      device: "lamp",
      tap_action: { action: "url" },
    },
    entity: "light.a",
  })
  f.requests[0].callback({ result: ["true", "123"] })
  assert.equal(f.results[0].name, true)
  assert.deepEqual(f.results[0].tap_action, { action: "url", url_path: 123 })
  f.requests[0].callback({ result: [undefined, 123] })
  assert.match(f.errors[0], /JSON-compatible/)
  stop()
})

test("templated entity does not become a sibling shorthand; identical plans share a subscription", () => {
  const f = fixture()
  const card = { type: "tile", $entity: "light.a", $name: "{{ entity is none }}" }
  const a = subscribeCardOptions(f.connection, card, f.consumer)!
  const b = subscribeCardOptions(f.connection, card, { result: () => {}, error: () => {} })!
  assert.deepEqual(f.requests[0].request.variables, { config: { type: "tile" }, entity: null })
  assert.equal(f.requests.length, 1)
  f.requests[0].callback({ result: ["light.a", "True"] })
  assert.equal(f.results[0].entity, "light.a")
  assert.equal(f.results[0].name, true)
  a()
  b()
})

const python = spawnSync("python3", ["-c", "import jinja2"])
test(
  "standalone Jinja resolves helpers and nested config without area/device shorthands",
  { skip: python.status !== 0 },
  () => {
    const f = fixture()
    const stop = subscribeCardOptions(
      f.connection,
      {
        type: "tile",
        entity: "light.a",
        area: "configured",
        $name:
          "{{ entity }} / {{ area_name(entity) }} / {{ config.area }} / {{ area is undefined }} / {{ device is undefined }}",
        tap_action: { action: "url", $url_path: "{{ '/entity/' ~ config.entity }}" },
      },
      f.consumer
    )!
    const request = f.requests[0].request
    const output = spawnSync(
      "python3",
      [fileURLToPath(new URL("render-template.py", import.meta.url))],
      {
        encoding: "utf8",
        input: JSON.stringify([
          {
            template: request.template,
            variables: request.variables,
            states: { "light.a": { state: "on" } },
            registry: { "light.a": { area_id: "kitchen" } },
            areas: { kitchen: { name: "Kitchen" } },
          },
        ]),
      }
    )
    assert.equal(output.status, 0, output.stderr)
    f.requests[0].callback({ result: rendered<string[]>(output.stdout)[0].result })
    assert.equal(f.results[0].name, "light.a / Kitchen / configured / True / True")
    assert.deepEqual(f.results[0].tap_action, { action: "url", url_path: "/entity/light.a" })
    stop()
  }
)
