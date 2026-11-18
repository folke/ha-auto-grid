import { testConnection } from "./helpers.ts"
import type { Callback, Dispose, Message } from "./helpers.ts"
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

test("retry refreshes a failed shared entry for every consumer and rejects stale callbacks", async () => {
  const callbacks: Callback[] = []
  let stops = 0
  const connection = testConnection({
    subscribeMessage(callback: Callback) {
      callbacks.push(callback)
      return Promise.resolve(() => {
        stops++
      })
    },
  })
  let refreshA = 0,
    refreshB = 0,
    refreshC = 0
  const a = {
    ...consumer(),
    refresh: () => {
      refreshA++
    },
  }
  const b = {
    ...consumer(),
    refresh: () => {
      refreshB++
    },
  }
  const stopA = subscribeTemplate(connection, "query", a)
  const stopB = subscribeTemplate(connection, "query", b)
  callbacks[0]({ result: ["cached"] })
  callbacks[0]({ error: "failed" })
  stopA.retry()
  assert.equal(callbacks.length, 2)
  assert.equal(refreshA, 1)
  assert.equal(refreshB, 1)
  const c = {
    ...consumer(),
    refresh: () => {
      refreshC++
    },
  }
  const stopC = subscribeTemplate(connection, "query", c)
  assert.deepEqual(c.errors, [])
  assert.deepEqual(c.results, [])
  assert.equal(refreshC, 1)
  callbacks[0]({ result: ["stale"] })
  callbacks[0]({ error: "stale failure" })
  assert.deepEqual(b.results, [["cached"]])
  assert.deepEqual(b.errors, ["failed"])
  callbacks[1]({ error: "failed again" })
  stopB.retry()
  assert.equal(refreshA, 2)
  assert.equal(refreshB, 2)
  callbacks[2]({ result: ["fresh"] })
  assert.deepEqual(c.results, [["fresh"]])
  assert.deepEqual(b.results, [["cached"], ["fresh"]])
  stopA()
  stopA.retry()
  assert.equal(callbacks.length, 3)
  stopB()
  stopC()
  await tick()
  assert.equal(stops, 3)
})

test("retry disposes late subscription setup without closing the replacement", async () => {
  const resolvers: ((value: Dispose) => void)[] = []
  const callbacks: Callback[] = []
  const stopped: string[] = []
  const connection = testConnection({
    subscribeMessage(callback: Callback) {
      callbacks.push(callback)
      return new Promise<Dispose>((resolve) => resolvers.push(resolve))
    },
  })
  const a = consumer()
  const stop = subscribeTemplate(connection, "query", a)
  stop.retry()
  resolvers[0](() => {
    stopped.push("old")
  })
  resolvers[1](() => {
    stopped.push("new")
  })
  await tick()
  assert.deepEqual(stopped, ["old"])
  callbacks[0]({ result: ["stale"] })
  callbacks[1]({ result: ["fresh"] })
  assert.deepEqual(a.results, [["fresh"]])
  stop()
  await tick()
  assert.deepEqual(stopped, ["old", "new"])
})
