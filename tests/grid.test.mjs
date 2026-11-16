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
  grid.configure(normalizeConfig({ entities: "{{ [] }}" }))
  grid.setHass(hass)
  const emit = (ids, index = subscriptions.length - 1) =>
    subscriptions[index].callback({ result: ids })
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

test("layout/options edits do not reopen a backend subscription", async () => {
  const f = fixture()
  f.grid.connect()
  f.emit(["light.pool"])
  await tick()
  const original = f.grid.cards[0].card
  f.grid.configure(normalizeConfig({ entities: "{{ [] }}", columns: 3 }))
  await tick()
  assert.equal(f.subscriptions.length, 1)
  assert.equal(f.grid.cards[0].card, original)
  f.grid.configure(normalizeConfig({ entities: "{{ [] }}", options: { type: "button" } }))
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
    normalizeConfig({ entities: "{{ ['light.new'] }}", options: { type: "button" } })
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
  assert.match(f.grid.error, /list of entity IDs/)
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

test("static lists need no backend subscription and preserve nested shared options", async () => {
  const f = fixture()
  f.grid.configure(
    normalizeConfig({ entities: ["light.a", "light.b"], options: { name: { type: "entity" } } })
  )
  f.grid.connect()
  await tick()
  assert.equal(f.subscriptions.length, 0)
  assert.equal(f.created.length, 2)
  f.created[0].config.name.type = "device"
  assert.equal(f.created[1].config.name.type, "entity")
  f.grid.disconnect()
})
