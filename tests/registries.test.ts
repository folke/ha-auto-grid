import {
  testConnection,
  testCard,
  type Callback,
  type Request,
  type Message,
  type Dispose,
} from "./helpers.ts"
import type { RegistryKind } from "../src/types.ts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { normalizeConfig, rendered } from "./helpers.ts"
import { subscribeTemplate } from "../src/subscriptions.ts"
import { watchRegistries } from "../src/registries.ts"
import { GridController } from "../src/grid.ts"

const tick = () => new Promise((resolve) => setImmediate(resolve))
function fixture() {
  const requests: Request[] = []
  let manifestCalls = 0
  const connection = testConnection({
    subscribeMessage(callback: Callback, request: Message) {
      const entry = { callback, request, closed: false }
      requests.push(entry)
      return Promise.resolve(() => {
        entry.closed = true
      })
    },
    async sendMessagePromise() {
      manifestCalls++
      return [{ domain: "mqtt", name: `MQTT ${manifestCalls}` }]
    },
  })
  const templates = () => requests.filter(({ request }) => request.type === "render_template")
  const registry = (kind: RegistryKind) =>
    requests.findLast(
      ({ request, closed }) =>
        !closed &&
        (kind === "integration"
          ? request.type === "config_entries/subscribe"
          : request.event_type === `${kind}_registry_updated`)
    )!
  return {
    connection,
    requests,
    templates,
    registry,
    get manifestCalls() {
      return manifestCalls
    },
  }
}
const consumer = () => {
  const values: unknown[] = [],
    errors: Error[] = []
  let refreshes = 0
  return {
    values,
    errors,
    result: (value: unknown) => values.push(value),
    error: (error: Error) => errors.push(error),
    refresh: () => refreshes++,
    get refreshes() {
      return refreshes
    },
  }
}

test("query dependencies include metadata from filters, sorting, grouping, and explicit templates", () => {
  const deps = (extra: Record<string, unknown>) =>
    normalizeConfig({ include: {}, sort: [], ...extra }).query.registries
  assert.deepEqual(deps({ include: { type: "light", state: true } }), [])
  assert.deepEqual(deps({ sort: "name" }), ["entity", "device"])
  assert.deepEqual(deps({ include: { area: "office" } }), ["entity", "device", "area"])
  assert.deepEqual(deps({ group: "floor" }), ["entity", "device", "area", "floor"])
  assert.deepEqual(deps({ exclude: { not: [{ any: [{ label: "test" }, { hidden: true }] }] } }), [
    "entity",
    "label",
  ])
  assert.deepEqual(deps({ sort: "integration" }), ["entity", "integration"])
  assert.deepEqual(deps({ card: { $icon: "mdi:lightbulb" } }), [])
  const all = ["entity", "device", "area", "floor", "label", "integration"]
  assert.deepEqual(deps({ card: { $name: "{{ entity }}" } }), all)
  assert.deepEqual(deps({ group: { by: "state", title: "{{ area_name(entity_id) }}" } }), all)
  assert.deepEqual(
    deps({ card: { type: "custom:mushroom-template-card", primary: "{{ area_name(entity) }}" } }),
    []
  )
  const template = normalizeConfig({ include: { area: "empty" }, sort: [] }).query.template
  assert.match(template, /set ag_lifecycle = states \| count/)
  assert.doesNotMatch(template, /states \| map/)
  assert.doesNotMatch(
    normalizeConfig({ include: { type: "light" }, sort: [] }).query.template,
    /set ag_lifecycle/,
    "domain iteration already tracks lifecycle; don't add unnecessary individual dependencies"
  )
})

test("shared queries coalesce registry bursts and reject replies from invalidated subscriptions", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const f = fixture(),
    a = consumer(),
    b = consumer()
  const options: { registries: RegistryKind[] } = { registries: ["entity", "area"] }
  const closeA = subscribeTemplate(f.connection, "query", a, undefined, options)
  const closeB = subscribeTemplate(f.connection, "query", b, undefined, options)
  assert.equal(f.requests.length, 3)
  f.templates()[0].callback({ result: "old" })
  for (let i = 0; i < 5; i++) f.registry("area").callback({ data: { action: "update" } })
  assert.equal(a.refreshes, 1)
  assert.equal(b.refreshes, 1)
  const c = consumer()
  const closeC = subscribeTemplate(f.connection, "query", c, undefined, options)
  assert.deepEqual(c.values, [], "stale cached results are not replayed to a new consumer")
  assert.equal(c.refreshes, 1)
  f.templates()[0].callback({ result: "stale" })
  assert.deepEqual(a.values, ["old"])
  t.mock.timers.tick(99)
  assert.equal(f.templates().length, 1)
  t.mock.timers.tick(1)
  await tick()
  assert.equal(f.templates().length, 2)
  assert.equal(f.templates()[0].closed, true)
  f.templates()[1].callback({ result: "fresh" })
  assert.deepEqual(a.values, ["old", "fresh"])
  assert.deepEqual(b.values, ["old", "fresh"])
  assert.deepEqual(c.values, ["fresh"])
  closeC()
  closeA()
  await tick()
  assert.equal(f.templates()[1].closed, false)
  closeB()
  await tick()
  assert.ok(f.requests.every(({ closed }) => closed))
})

test("registry watchers are shared across distinct queries and unrelated kinds don't refresh them", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const f = fixture()
  const a = consumer(),
    b = consumer(),
    c = consumer()
  const closes = [
    subscribeTemplate(f.connection, "a", a, undefined, { registries: ["entity"] }),
    subscribeTemplate(f.connection, "b", b, undefined, { registries: ["entity"] }),
    subscribeTemplate(f.connection, "c", c, undefined, { registries: ["label"] }),
  ]
  assert.equal(
    f.requests.filter(({ request }) => request.event_type === "entity_registry_updated").length,
    1
  )
  f.registry("label").callback({ data: { action: "remove" } })
  t.mock.timers.tick(100)
  assert.equal(a.refreshes, 0)
  assert.equal(b.refreshes, 0)
  assert.equal(c.refreshes, 1)
  f.registry("entity").callback({ data: { action: "update" } })
  t.mock.timers.tick(100)
  assert.equal(a.refreshes, 1)
  assert.equal(b.refreshes, 1)
  assert.equal(f.templates().length, 6)
  closes.forEach((close) => close())
  await tick()
  assert.ok(f.requests.every(({ closed }) => closed))
})

test("a new registry edit invalidates an in-flight replacement and closing cancels queued refreshes", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const f = fixture(),
    c = consumer()
  const close = subscribeTemplate(f.connection, "query", c, undefined, { registries: ["entity"] })
  f.registry("entity").callback({})
  t.mock.timers.tick(100)
  f.registry("entity").callback({})
  f.templates()[1].callback({ result: "too old" })
  assert.deepEqual(c.values, [])
  t.mock.timers.tick(100)
  f.templates()[2].callback({ result: "fresh" })
  assert.deepEqual(c.values, ["fresh"])
  f.registry("entity").callback({})
  close()
  t.mock.timers.tick(1000)
  await tick()
  assert.equal(f.templates().length, 3)
  assert.ok(f.requests.every(({ closed }) => closed))
})

test("pending setup is disposed even if invalidated or disconnected before its unsubscribe arrives", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const f = fixture(),
    pending: { callback: Callback; resolve: (dispose: Dispose) => void }[] = []
  const original = f.connection.subscribeMessage
  f.connection.subscribeMessage = (callback, request) => {
    if (request.type !== "render_template") return original(callback, request)
    return new Promise<Dispose>((resolve) =>
      pending.push({ callback: callback as Callback, resolve })
    )
  }
  const close = subscribeTemplate(f.connection, "query", consumer(), undefined, {
    registries: ["entity"],
  })
  f.registry("entity").callback({})
  t.mock.timers.tick(100)
  close()
  let stops = 0
  pending.forEach(({ resolve }) =>
    resolve(() => {
      stops++
    })
  )
  await tick()
  assert.equal(stops, 2)
  const late = fixture()
  let resolveRegistry!: (dispose: Dispose) => void,
    registryStops = 0
  late.connection.subscribeMessage = () =>
    new Promise<Dispose>((resolve) => {
      resolveRegistry = resolve
    })
  const stop = watchRegistries(late.connection, ["area"], () => assert.fail("closed watcher fired"))
  stop()
  resolveRegistry(() => {
    registryStops++
  })
  await tick()
  assert.equal(registryStops, 1)
})

test("config-entry changes refresh integration names; initial snapshots do not loop", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const f = fixture(),
    c = consumer()
  const close = subscribeTemplate(f.connection, "query", c, undefined, {
    registries: ["integration"],
    integrationNames: true,
  })
  f.registry("integration").callback([{ type: null, entry: { domain: "mqtt" } }])
  await tick()
  assert.equal(f.templates().length, 1)
  assert.equal(
    (f.templates()[0].request.variables as { ag_integration_names: Record<string, string> })
      .ag_integration_names.mqtt,
    "MQTT 1"
  )
  f.registry("integration").callback([{ type: "updated", entry: { domain: "mqtt" } }])
  t.mock.timers.tick(100)
  await tick()
  assert.equal(
    (f.templates()[1].request.variables as { ag_integration_names: Record<string, string> })
      .ag_integration_names.mqtt,
    "MQTT 2"
  )
  f.registry("integration").callback([{ type: null, entry: { domain: "mqtt" } }])
  t.mock.timers.tick(100)
  await tick()
  assert.equal(f.manifestCalls, 3, "a reconnect snapshot refreshes manifest names")
  close()
  await tick()
  const closeAgain = subscribeTemplate(f.connection, "query", consumer(), undefined, {
    registries: ["integration"],
    integrationNames: true,
  })
  await tick()
  assert.equal(f.manifestCalls, 4, "reactivation refreshes names after an unwatched interval")
  closeAgain()
})

test("an empty scoped grid populates on registry changes and retained cards never enter a loading placeholder", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const f = fixture(),
    made = []
  const grid = new GridController(
    async (config) => {
      const card = testCard(config)
      made.push(card)
      return card
    },
    () => {}
  )
  grid.configure(normalizeConfig({ include: { area: "office" } }))
  grid.setHass({ connection: f.connection, states: {} })
  grid.connect()
  f.templates()[0].callback({ result: [] })
  await tick()
  f.registry("area").callback({ data: { action: "update" } })
  t.mock.timers.tick(100)
  f.templates()[1].callback({ result: [{ entity: "light.new", group: 0 }] })
  await tick()
  const card = grid.cards[0].card
  f.registry("entity").callback({
    data: { action: "update", entity_id: "light.new", changes: { labels: [] } },
  })
  assert.equal(grid.loading, true)
  assert.equal(grid.cards[0].card, card)
  t.mock.timers.tick(100)
  f.templates()[2].callback({ result: [{ entity: "light.new", group: 0 }] })
  await tick()
  assert.equal(grid.cards[0].card, card)
  assert.equal(made.length, 1)
  grid.disconnect()
  await tick()
  assert.ok(f.requests.every(({ closed }) => closed))
})

const python = spawnSync("python3", ["-c", "import jinja2"], { encoding: "utf8" })
test(
  "metadata-only scoped queries track entity lifecycle without collecting individual state changes",
  {
    skip: python.status !== 0 ? "Optional check requires Python 3 with jinja2 installed" : false,
  },
  () => {
    const config = normalizeConfig({ include: { label: "office", hidden: false } })
    const output = spawnSync(
      "python3",
      [fileURLToPath(new URL("./render-template.py", import.meta.url))],
      {
        input: JSON.stringify([
          {
            template: config.query.template,
            states: {
              "light.a": { name: "A", state: "on" },
              "light.b": { name: "B", state: "off" },
            },
            registry: {
              "light.a": { entity_name: "A" },
              "light.b": { entity_name: "B", hidden_by: "user" },
            },
            memberships: { "label:office": ["light.a", "light.b", "light.missing"] },
          },
        ]),
        encoding: "utf8",
      }
    )
    assert.equal(output.status, 0, output.stderr)
    const [actual] = rendered(output.stdout)
    assert.deepEqual(actual.result, [{ entity: "light.a", group: 0 }])
    assert.deepEqual(actual.state_reads, [])
    assert.equal(actual.lifecycle_reads, 1)
  }
)

test("integration load events refresh manifest names even without config entries", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const f = fixture()
  const close = subscribeTemplate(f.connection, "query", consumer(), undefined, {
    registries: ["integration"],
    integrationNames: true,
  })
  await tick()
  assert.equal(f.manifestCalls, 1)
  f.requests
    .find(({ request }) => request.event_type === "component_loaded")!
    .callback({ data: { component: "yaml_template" } })
  t.mock.timers.tick(100)
  await tick()
  assert.equal(f.manifestCalls, 2)
  assert.equal(
    (f.templates()[1].request.variables as { ag_integration_names: Record<string, string> })
      .ag_integration_names.mqtt,
    "MQTT 2"
  )
  close()
  await tick()
  assert.ok(f.requests.every(({ closed }) => closed))
})
