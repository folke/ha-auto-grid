import { testConnection, type Message } from "./helpers.ts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { integrationNames } from "../src/integrations.ts"

test("integration names share a cached native manifest request per connection", async () => {
  let calls = 0
  const connection = testConnection({
    sendMessagePromise: async (message: Message) => {
      calls++
      assert.deepEqual(message, { type: "manifest/list" })
      return [
        { domain: "zha", name: "Zigbee Home Automation" },
        { domain: "mqtt", name: "MQTT" },
      ]
    },
  })
  const [a, b] = await Promise.all([integrationNames(connection), integrationNames(connection)])
  assert.equal(calls, 1)
  assert.equal(a, b)
  assert.deepEqual(a, { mqtt: "MQTT", zha: "Zigbee Home Automation" })
  assert.equal(await integrationNames(connection), a)
  assert.deepEqual(await integrationNames(testConnection()), {})
})

test("manifest failure falls back to domains and can retry on a later activation", async (t) => {
  t.mock.method(console, "debug", () => {})
  let calls = 0
  const connection = testConnection({
    sendMessagePromise: async () => {
      calls++
      if (calls === 1) throw new Error("offline")
      return [{ domain: "mqtt", name: "MQTT" }]
    },
  })
  assert.deepEqual(await integrationNames(connection), {})
  assert.deepEqual(await integrationNames(connection), { mqtt: "MQTT" })
  assert.equal(calls, 2)
})
