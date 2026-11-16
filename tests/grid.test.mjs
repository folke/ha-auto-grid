import assert from "node:assert/strict"
import { test } from "node:test"
import { GridController } from "../src/grid.ts"
import { normalizeConfig } from "../src/query.ts"

const tick = () => new Promise((resolve) => setImmediate(resolve))
function fixture(create) {
  const subscriptions = [],
    created = []
  let stops = 0,
    updates = 0
  const connection = {
    subscribeMessage(callback, request) {
      subscriptions.push({ callback, request })
      return Promise.resolve(() => {
        stops++
      })
    },
  }
  const hass = { connection, states: {} }
  const grid = new GridController(
    create ??
      (async (config) => {
        const card = { config }
        created.push(card)
        return card
      }),
    () => {
      updates++
    }
  )
  grid.configure(normalizeConfig({ include: { domain: "light" } }))
  grid.setHass(hass)
  const emit = (ids, index = subscriptions.length - 1) =>
    subscriptions[index].callback({
      result: Array.isArray(ids)
        ? ids.map((id) => (typeof id === "string" ? { entity: id, group: 0 } : id))
        : ids,
    })
  return {
    grid,
    hass,
    subscriptions,
    created,
    emit,
    get stops() {
      return stops
    },
    get updates() {
      return updates
    },
  }
}

test("only subscribes while connected; reconnect retains child cards", async () => {
  const f = fixture()
  assert.equal(f.subscriptions.length, 0)
  f.grid.connect()
  f.emit(["light.pool"])
  await tick()
  const card = f.grid.cards[0].card
  f.grid.disconnect()
  await tick()
  assert.equal(f.stops, 1)
  f.emit(["light.stale"])
  await tick()
  assert.equal(f.grid.cards[0].card, card)
  f.grid.connect()
  assert.equal(f.subscriptions.length, 2)
  f.emit(["light.pool"])
  await tick()
  assert.equal(f.grid.cards[0].card, card)
  f.grid.disconnect()
})

test("hass updates only forward state: no query, rendering, or card configuration work", async () => {
  const f = fixture()
  f.grid.connect()
  f.emit(["light.pool"])
  await tick()
  const updates = f.updates
  for (let i = 0; i < 100; i++) f.grid.setHass({ ...f.hass, states: { generation: i } })
  assert.equal(f.updates, updates)
  assert.equal(f.subscriptions.length, 1)
  assert.equal(f.created.length, 1)
  assert.equal(f.grid.cards[0].card.hass.states.generation, 99)
  f.emit(["light.pool"])
  await tick()
  assert.equal(f.updates, updates)
  f.grid.disconnect()
})

test("reorders retained cards and creates only added entities", async () => {
  const f = fixture()
  f.grid.connect()
  f.emit(["light.a", "light.b"])
  await tick()
  const [a, b] = f.grid.cards.map(({ card }) => card)
  f.emit(["light.b", "light.a", "light.c"])
  await tick()
  assert.equal(f.created.length, 3)
  assert.equal(f.grid.cards[0].card, b)
  assert.equal(f.grid.cards[1].card, a)
  f.emit(["light.b"])
  await tick()
  assert.equal(f.grid.cards.length, 1)
  assert.equal(f.grid.cards[0].card, b)
  f.emit([])
  await tick()
  assert.deepEqual(f.grid.cards, [])
  f.grid.disconnect()
})

test("layout/card edits do not reopen a backend subscription", async () => {
  const f = fixture()
  f.grid.connect()
  f.emit(["light.pool"])
  await tick()
  const original = f.grid.cards[0].card
  f.grid.configure(normalizeConfig({ include: { domain: "light" }, columns: 3 }))
  await tick()
  assert.equal(f.subscriptions.length, 1)
  assert.equal(f.grid.cards[0].card, original)
  f.grid.configure(normalizeConfig({ include: { domain: "light" }, card: { type: "button" } }))
  await tick()
  assert.equal(f.subscriptions.length, 1)
  assert.notEqual(f.grid.cards[0].card, original)
  assert.equal(f.grid.cards[0].card.config.type, "button")
  f.grid.disconnect()
})

test("changed queries discard old callbacks and empty results remove previous cards", async () => {
  const f = fixture()
  f.grid.connect()
  f.emit(["light.pool"])
  await tick()
  f.grid.configure(
    normalizeConfig({ include: { entity_id: "light.new" }, card: { type: "button" } })
  )
  f.emit(["light.stale"], 0)
  f.emit([])
  await tick()
  assert.deepEqual(f.grid.cards, [])
  f.grid.disconnect()
})

test("a slow result cannot overwrite a newer selection", async () => {
  const pending = new Map()
  const f = fixture(
    (config) => new Promise((resolve) => pending.set(config.entity, () => resolve({ config })))
  )
  f.grid.connect()
  f.emit(["light.old"])
  f.emit(["light.new"])
  pending.get("light.new")()
  await tick()
  pending.get("light.old")()
  await tick()
  assert.deepEqual(
    f.grid.cards.map(({ entity }) => entity),
    ["light.new"]
  )
  f.grid.disconnect()
})

test("pending card creation is discarded after disconnect", async () => {
  let finish
  const f = fixture(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  f.grid.connect()
  f.emit(["light.pool"])
  f.grid.disconnect()
  finish({})
  await tick()
  assert.deepEqual(f.grid.cards, [])
})

test("invalid results show an error and a subsequent valid result recovers", async () => {
  const f = fixture()
  f.grid.connect()
  f.emit("not a list")
  await tick()
  assert.match(f.grid.error, /list of entity\/group matches/)
  f.emit(["light.pool"])
  await tick()
  assert.equal(f.grid.error, undefined)
  assert.equal(f.grid.loading, false)
  assert.equal(f.grid.cards.length, 1)
  f.grid.disconnect()
})

test("card helper failures can be retried", async () => {
  let fail = true
  const f = fixture(async () => {
    if (fail) throw new Error("helper failed")
    return {}
  })
  f.grid.connect()
  f.emit(["light.pool"])
  await tick()
  assert.equal(f.grid.error, "helper failed")
  fail = false
  f.grid.retry()
  f.emit(["light.pool"])
  await tick()
  assert.equal(f.grid.error, undefined)
  assert.equal(f.grid.cards.length, 1)
  f.grid.disconnect()
})

test("connection replacement releases the old subscription", async () => {
  const f = fixture()
  f.grid.connect()
  const newConnection = { subscribeMessage: () => Promise.resolve(() => {}) }
  f.grid.setHass({ ...f.hass, connection: newConnection })
  await tick()
  assert.equal(f.stops, 1)
  f.emit(["light.stale"])
  await tick()
  assert.deepEqual(f.grid.cards, [])
  f.grid.disconnect()
})

test("explicit entity queries preserve independent nested card options", async () => {
  const f = fixture()
  f.grid.configure(
    normalizeConfig({
      include: { entity_id: ["light.a", "light.b"] },
      card: { name: { type: "entity" } },
    })
  )
  f.grid.connect()
  await tick()
  assert.equal(f.subscriptions.length, 1)
  f.emit(["light.a", "light.b"])
  await tick()
  assert.equal(f.created.length, 2)
  f.created[0].config.name.type = "device"
  assert.equal(f.created[1].config.name.type, "entity")
  f.grid.disconnect()
})

test("changing one group's card only recreates that group's children", async () => {
  const f = fixture()
  const config = {
    card: { name: { type: "entity" }, features: ["shared"] },
    include: [{ domain: "light" }, { domain: "sensor" }],
  }
  f.grid.configure(normalizeConfig(config))
  f.grid.connect()
  f.emit([
    { entity: "light.a", group: 0 },
    { entity: "sensor.b", group: 1 },
  ])
  await tick()
  const [a, b] = f.grid.cards.map(({ card }) => card)
  f.grid.configure(
    normalizeConfig({
      ...config,
      include: [{ domain: "light", card: { type: "button", features: [] } }, { domain: "sensor" }],
    })
  )
  await tick()
  assert.equal(f.subscriptions.length, 1)
  assert.notEqual(f.grid.cards[0].card, a)
  assert.equal(f.grid.cards[1].card, b)
  assert.deepEqual(f.grid.cards[0].card.config, {
    type: "button",
    name: { type: "entity" },
    features: [],
    entity: "light.a",
  })
  assert.equal(f.created.length, 3)
  f.grid.disconnect()
})

test("a winning-group change replaces the card only if effective configuration changes", async () => {
  const f = fixture()
  f.grid.configure(
    normalizeConfig({
      include: [
        { domain: "light" },
        { domain: "light" },
        { domain: "light", card: { type: "button" } },
      ],
    })
  )
  f.grid.connect()
  f.emit([{ entity: "light.a", group: 0 }])
  await tick()
  const card = f.grid.cards[0].card
  const updates = f.updates
  f.emit([{ entity: "light.a", group: 1 }])
  await tick()
  assert.equal(f.grid.cards[0].card, card)
  assert.equal(f.grid.cards[0].group, 1)
  assert.equal(f.updates, updates)
  f.emit([{ entity: "light.a", group: 2 }])
  await tick()
  assert.notEqual(f.grid.cards[0].card, card)
  assert.equal(f.grid.cards[0].card.config.type, "button")
  assert.equal(f.created.length, 2)
  f.grid.disconnect()
})

test("editing group options during pending card creation cannot commit old options", async () => {
  const pending = []
  const f = fixture((config) => new Promise((resolve) => pending.push(() => resolve({ config }))))
  f.grid.connect()
  f.emit(["light.a"])
  f.grid.configure(normalizeConfig({ include: { domain: "light" }, card: { type: "button" } }))
  pending[1]()
  await tick()
  pending[0]()
  await tick()
  assert.equal(f.subscriptions.length, 1)
  assert.equal(f.grid.cards[0].card.config.type, "button")
  f.grid.disconnect()
})

test("identical queries share subscriptions even with different card configurations", async () => {
  const f = fixture()
  const other = new GridController(
    async (config) => ({ config }),
    () => {}
  )
  other.configure(normalizeConfig({ include: { domain: "light" }, card: { type: "button" } }))
  other.setHass(f.hass)
  f.grid.connect()
  other.connect()
  assert.equal(f.subscriptions.length, 1)
  f.emit(["light.a"])
  await tick()
  assert.equal(f.grid.cards[0].card.config.type, "tile")
  assert.equal(other.cards[0].card.config.type, "button")
  f.grid.disconnect()
  await tick()
  assert.equal(f.stops, 0)
  other.disconnect()
  await tick()
  assert.equal(f.stops, 1)
})

test("group title and membership changes preserve cards and update sections", async () => {
  const f = fixture()
  f.grid.configure(normalizeConfig({ include: { domain: "light" }, group: "area" }))
  f.grid.connect()
  const section = (value, title, entities) => ({
    value,
    title,
    matches: entities.map((entity) => ({ entity, group: 0 })),
  })
  f.emit([section("Pool", "Pool", ["light.a"]), section("Other", "Other", ["light.b"])])
  await tick()
  const [a, b] = f.grid.cards.map(({ card }) => card)
  const updates = f.updates
  f.emit([section("Pool", "Renamed", ["light.a"]), section("Other", "Other", ["light.b"])])
  await tick()
  assert.equal(f.updates, updates + 1)
  assert.equal(f.grid.sections[0].title, "Renamed")
  assert.equal(f.grid.sections[0].cards[0].card, a)
  f.emit([section("Other", "Other", ["light.a", "light.b"])])
  await tick()
  assert.equal(f.grid.sections.length, 1)
  assert.deepEqual(
    f.grid.sections[0].cards.map(({ card }) => card),
    [a, b]
  )
  assert.equal(f.created.length, 2)
  const unchanged = f.updates
  f.emit([section("Other", "Other", ["light.a", "light.b"])])
  await tick()
  assert.equal(f.updates, unchanged)
  f.grid.disconnect()
})

test("grouped card configuration changes use the retained raw selection", async () => {
  const f = fixture()
  const config = { include: { domain: "light" }, group: true }
  f.grid.configure(normalizeConfig(config))
  f.grid.connect()
  f.emit([{ value: 0, title: "0", matches: [{ entity: "light.a", group: 0 }] }])
  await tick()
  f.grid.configure(normalizeConfig({ ...config, card: { type: "button" } }))
  await tick()
  assert.equal(f.subscriptions.length, 1)
  assert.equal(f.grid.sections[0].cards[0].card.config.type, "button")
  f.grid.disconnect()
})

test("pending integration metadata never opens a subscription after disconnection", async () => {
  const f = fixture()
  let finish
  f.hass.connection.sendMessagePromise = () =>
    new Promise((resolve) => {
      finish = resolve
    })
  f.grid.configure(normalizeConfig({ include: { domain: "light" }, group: "integration" }))
  f.grid.connect()
  await tick()
  f.grid.disconnect()
  finish([{ domain: "mqtt", name: "MQTT" }])
  await tick()
  assert.equal(f.subscriptions.length, 0)
})

test("changed rendered options update only affected cards, with no ordinary hass work", async () => {
  const created = []
  const f = fixture(async (config) => {
    const card = {
      config,
      updates: 0,
      setConfig(next) {
        this.config = next
        this.updates++
      },
    }
    created.push(card)
    return card
  })
  f.grid.configure(
    normalizeConfig({ include: { type: "light" }, card: { $name: "{{ states(entity) }}" } })
  )
  f.grid.connect()
  const rows = [
    { entity: "light.a", group: 0, values: ["on"] },
    { entity: "light.b", group: 0, values: ["off"] },
  ]
  f.emit(rows)
  await tick()
  const [a, b] = created
  f.emit(rows)
  await tick()
  for (let i = 0; i < 20; i++) f.grid.setHass({ ...f.hass, states: { generation: i } })
  assert.equal(a.updates, 0)
  f.emit([{ ...rows[0], values: ["off"] }, rows[1]])
  await tick()
  assert.equal(f.grid.cards[0].card, a)
  assert.equal(created.length, 2)
  assert.equal(a.updates, 1)
  assert.equal(a.config.name, "off")
  assert.equal(b.updates, 0)
  assert.equal(f.subscriptions.length, 1)
  f.emit([{ ...rows[0], values: [] }])
  await tick()
  assert.match(f.grid.error, /template values/)
  assert.equal(a.updates, 1)
  f.grid.disconnect()
})

test("a rendered card type change replaces rather than reconfigures the element", async () => {
  const created = []
  const f = fixture(async (config) => {
    const card = {
      config,
      updates: 0,
      setConfig() {
        this.updates++
      },
    }
    created.push(card)
    return card
  })
  f.grid.configure(normalizeConfig({ include: { type: "light" }, card: { $type: "{{ 'tile' }}" } }))
  f.grid.connect()
  f.emit([{ entity: "light.a", group: 0, values: ["tile"] }])
  await tick()
  f.emit([{ entity: "light.a", group: 0, values: ["button"] }])
  await tick()
  assert.equal(created.length, 2)
  assert.equal(created[0].updates, 0)
  assert.equal(f.grid.cards[0].card, created[1])
  assert.equal(created[1].config.type, "button")
  f.grid.disconnect()
})

test("stale asynchronous selections cannot reconfigure retained cards", async () => {
  let finish
  const a = {
    config: undefined,
    updates: [],
    setConfig(config) {
      this.config = config
      this.updates.push(config.name)
    },
  }
  const f = fixture(async (config) => {
    if (config.entity === "light.b")
      return new Promise((resolve) => {
        finish = () => resolve({ config })
      })
    a.config = config
    return a
  })
  f.grid.configure(
    normalizeConfig({ include: { type: "light" }, card: { $name: "{{ states(entity) }}" } })
  )
  f.grid.connect()
  f.emit([{ entity: "light.a", group: 0, values: ["initial"] }])
  await tick()
  f.emit([
    { entity: "light.a", group: 0, values: ["stale"] },
    { entity: "light.b", group: 0, values: ["new"] },
  ])
  f.emit([{ entity: "light.a", group: 0, values: ["latest"] }])
  await tick()
  finish()
  await tick()
  assert.deepEqual(a.updates, ["latest"])
  assert.equal(a.config.name, "latest")
  assert.equal(f.grid.cards.length, 1)
  f.grid.disconnect()
})
