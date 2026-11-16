import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { compileFilter } from "../src/query.ts"

const python = spawnSync("python3", ["-c", "import jinja2"], { encoding: "utf8" })
test(
  "compiled queries execute correctly in a sandboxed Jinja environment",
  {
    skip: python.status !== 0 ? "Optional check requires Python 3 with jinja2 installed" : false,
  },
  () => {
    const states = {
      "light.pool": { state: "on", name: "Pool" },
      "light.hall": { state: "off", name: "Hall" },
      "light.deck": { state: "on", name: "Deck" },
      "sensor.low": { state: "12", name: "Low", attributes: { battery: 12, present: true } },
      "sensor.high": { state: "80", name: "High", attributes: { battery: 80, present: false } },
      "sensor.missing": { state: "unavailable", name: "Missing" },
      "sensor.weird": { state: `a') }} {{ states`, name: "Weird" },
    }
    const memberships = {
      "area:pool": ["light.pool", "light.deck", "sensor.low", "light.disabled"],
      "label:outside": ["light.deck"],
      "device:device_id": ["sensor.low", "sensor.high"],
      "floor:ground": ["light.hall", "light.pool"],
    }
    const cases = [
      [{ area: "pool", domain: "light" }, { by: "name" }, undefined, ["light.deck", "light.pool"]],
      [
        { area: "pool", domain: "light", state: "on" },
        undefined,
        undefined,
        ["light.pool", "light.deck"],
      ],
      [
        { domain: "light", any: [{ state: "off" }, { label: "outside" }] },
        undefined,
        undefined,
        ["light.hall", "light.deck"],
      ],
      [
        { all: [{ area: "pool" }, { not: { domain: "sensor" } }] },
        undefined,
        undefined,
        ["light.pool", "light.deck"],
      ],
      [
        { any: [{ domain: "light" }, { device: "device_id" }] },
        undefined,
        4,
        ["light.pool", "light.hall", "light.deck", "sensor.low"],
      ],
      [{ not: { domain: "light" } }, undefined, 2, ["sensor.low", "sensor.high"]],
      [{ domain: "sensor", state: "<20" }, undefined, undefined, ["sensor.low"]],
      [
        { domain: "sensor", attributes: { battery: ">= 80" } },
        undefined,
        undefined,
        ["sensor.high"],
      ],
      [{ domain: "sensor", attributes: { present: true } }, undefined, undefined, ["sensor.low"]],
      [
        { entity_id: "light.*", name: "/^[DP]/" },
        undefined,
        undefined,
        ["light.pool", "light.deck"],
      ],
      [{ entity_id: "light.*", name: "P*" }, undefined, undefined, ["light.pool"]],
      [{ domain: "sensor", state: `a') }} {{ states` }, undefined, undefined, ["sensor.weird"]],
      [
        { domain: "sensor" },
        { by: "state", numeric: true, reverse: true },
        undefined,
        ["sensor.high", "sensor.low", "sensor.missing", "sensor.weird"],
      ],
      [{ domain: "light" }, { by: "name", reverse: true }, 2, ["light.pool", "light.hall"]],
      [{ floor: "ground" }, undefined, undefined, ["light.hall", "light.pool"]],
      [
        { entity_id: ["light.pool", "light.pool", "light.disabled"] },
        undefined,
        undefined,
        ["light.pool"],
      ],
      [
        { domain: ["light", "sensor"], state: ["on", 12] },
        undefined,
        undefined,
        ["light.pool", "light.deck", "sensor.low"],
      ],
      [{ domain: "light" }, undefined, 0, []],
      [{ any: [] }, undefined, undefined, []],
      [
        { domain: "light", all: [] },
        undefined,
        undefined,
        ["light.pool", "light.hall", "light.deck"],
      ],
      [{ domain: "light", name: "P.*" }, undefined, undefined, []],
      [
        { entity_id: "sensor.low", attributes: { absent: null } },
        undefined,
        undefined,
        ["sensor.low"],
      ],
      [
        { device: "device_id" },
        { by: "attribute", attribute: "battery", numeric: true },
        undefined,
        ["sensor.low", "sensor.high"],
      ],
      [
        { domain: "light" },
        { by: "last_updated" },
        undefined,
        ["light.pool", "light.hall", "light.deck"],
      ],
    ]
    const payload = cases.map(([filter, sort, limit]) => ({
      template: compileFilter(filter, sort, limit),
      states,
      memberships,
    }))
    const result = spawnSync(
      "python3",
      [fileURLToPath(new URL("./render-template.py", import.meta.url))],
      {
        input: JSON.stringify(payload),
        encoding: "utf8",
      }
    )
    assert.equal(result.status, 0, result.stderr)
    JSON.parse(result.stdout).forEach((actual, index) => {
      assert.deepEqual(
        actual.result,
        cases[index][3],
        `case ${index}: ${JSON.stringify(cases[index][0])}`
      )
      for (const calls of Object.values(actual.calls))
        assert.equal(calls, 1, "registry helpers are hoisted")
    })
  }
)
