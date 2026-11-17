import { testConnection, type Callback, type Dispose, type Message } from "./helpers.ts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { subscribeTemplate } from "../src/subscriptions.ts"

const tick = () => new Promise((resolve) => setImmediate(resolve))
function consumer() {
  const results: unknown[] = [],
    errors: string[] = []
  return {
    results,
    errors,
    result: (value: unknown) => results.push(value),
    error: (error: Error) => errors.push(error.message),
  }
}

test("shares subscriptions by connection and template, and replays current results", async () => {
  let callback!: Callback
  let calls = 0,
    stops = 0
  const connection = testConnection({
    subscribeMessage(cb: Callback) {
      callback = cb
      calls++
      return Promise.resolve(() => {
        stops++
      })
    },
  })
  const a = consumer(),
    b = consumer()
  const stopA = subscribeTemplate(connection, "{{ [] }}", a)
  callback({ result: ["light.pool"] })
  const stopB = subscribeTemplate(connection, "{{ [] }}", b)
  assert.equal(calls, 1)
  assert.deepEqual(b.results, [["light.pool"]])
  stopA()
  callback({ result: [] })
  assert.equal(a.results.length, 1)
  assert.equal(b.results.length, 2)
  await tick()
  assert.equal(stops, 0)
  stopB()
  stopB()
  await tick()
  assert.equal(stops, 1)
  callback({ result: ["light.stale"] })
  assert.equal(b.results.length, 2)
})

test("unsubscribes even when disconnected before subscription setup completes", async () => {
  let resolve!: (value: Dispose) => void
  let stops = 0
  const pending = new Promise<Dispose>((done) => {
    resolve = done
  })
  const connection = testConnection({
    subscribeMessage() {
      return pending
    },
  })
  const stop = subscribeTemplate(connection, "pending", consumer())
  stop()
  resolve(() => {
    stops++
  })
  await tick()
  assert.equal(stops, 1)
})

test("a closed entry cannot dispose a newer subscription for the same query", async () => {
  const resolvers: ((value: Dispose) => void)[] = [],
    callbacks: Callback[] = [],
    stops: string[] = []
  const connection = testConnection({
    subscribeMessage(cb: Callback) {
      callbacks.push(cb)
      return new Promise<Dispose>((resolve) => resolvers.push(resolve))
    },
  })
  const stopA = subscribeTemplate(connection, "query", consumer())
  stopA()
  const b = consumer()
  const stopB = subscribeTemplate(connection, "query", b)
  resolvers[0](() => {
    stops.push("a")
  })
  resolvers[1](() => {
    stops.push("b")
  })
  await tick()
  callbacks[0]({ result: ["light.stale"] })
  callbacks[1]({ result: ["light.fresh"] })
  assert.deepEqual(b.results, [["light.fresh"]])
  assert.deepEqual(stops, ["a"])
  stopB()
  await tick()
  assert.deepEqual(stops, ["a", "b"])
})

test("separates connections and queries", () => {
  let count = 0
  const create = () => ({
    subscribeMessage() {
      count++
      return Promise.resolve(() => {})
    },
  })
  const a = create(),
    b = create()
  const stops = [
    subscribeTemplate(a, "one", consumer()),
    subscribeTemplate(a, "two", consumer()),
    subscribeTemplate(b, "one", consumer()),
  ]
  assert.equal(count, 3)
  stops.forEach((stop) => stop())
})

test("subscription errors are surfaced and recoverable results clear cached errors", async () => {
  let callback!: Callback
  const connection = testConnection({
    subscribeMessage(cb: Callback) {
      callback = cb
      return Promise.resolve(() => {})
    },
  })
  const a = consumer()
  const stopA = subscribeTemplate(connection, "query", a)
  callback({ error: { message: "bad template" } })
  const b = consumer()
  const stopB = subscribeTemplate(connection, "query", b)
  assert.deepEqual(a.errors, ["bad template"])
  assert.deepEqual(b.errors, ["bad template"])
  callback({ result: [] })
  assert.deepEqual(b.results, [[]])
  stopA()
  stopB()
  const c = consumer()
  const stopC = subscribeTemplate(
    { subscribeMessage: () => Promise.reject(new Error("offline")) },
    "query",
    c
  )
  await tick()
  assert.deepEqual(c.errors, ["offline"])
  stopC()
})

test("template variables participate in subscription sharing", () => {
  const requests: Message[] = []
  const connection = testConnection({
    subscribeMessage(callback: Callback, request: Message) {
      requests.push(request)
      return Promise.resolve(() => {})
    },
  })
  const a = subscribeTemplate(connection, "query", consumer(), {
    ag_integration_names: { mqtt: "MQTT" },
  })
  const b = subscribeTemplate(connection, "query", consumer(), {
    ag_integration_names: { mqtt: "MQTT" },
  })
  const c = subscribeTemplate(connection, "query", consumer(), { ag_integration_names: {} })
  assert.equal(requests.length, 2)
  assert.deepEqual(requests[0].variables, { ag_integration_names: { mqtt: "MQTT" } })
  a()
  b()
  c()
})
