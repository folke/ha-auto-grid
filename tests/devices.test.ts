import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { normalizeConfig, rendered } from "./helpers.ts"

const query = (include: unknown) => normalizeConfig({ include }).query.template

test("device patterns check IDs and effective names without unsafe device candidate narrowing", () => {
  const include = {
    domain: "device_tracker",
    integration: "omada_open_api",
    any: [{ device: "/Pixel|Xiaomi/" }, { name: "/Pixel|Xiaomi/" }],
  }
  const template = query(include)
  assert.match(template, /device_id\(entity\)/)
  assert.match(template, /device_name\(entity\)/)
  assert.match(template, /integration_entities\("omada_open_api"\)/)
  assert.doesNotMatch(template, /device_entities|for ag_state in \(states\)/)
  assert.match(query({ device: "dev_pixel" }), /for ag_state in \(states\)/)
  assert.match(query({ domain: "device_tracker", device: "/Pixel/" }), /states.device_tracker/)
  assert.doesNotMatch(
    query({ domain: "device_tracker", device: "/Pixel/" }),
    /for ag_state in \(states\)/
  )
  assert.match(query({ area: "office", device: "/Pixel/" }), /area_entities\("office"\)/)
  assert.match(
    query({ all: [{ integration: "omada_open_api" }, { device: "/Pixel/" }] }),
    /integration_entities/
  )
  for (const device of [null, 3, [], {}, [false]])
    assert.throws(() => normalizeConfig({ include: { device } }))
})

const python = spawnSync("python3", ["-c", "import jinja2"], { encoding: "utf8" })
test(
  "device matches exact IDs/names, globs, regexes, aliases, lists, and nested filters",
  {
    skip: python.status !== 0 ? "Optional check requires Python 3 with jinja2 installed" : false,
  },
  () => {
    const odd = "Phone') }} {{ danger"
    const states = {
      "device_tracker.pixel": { state: "home", name: "A" },
      "device_tracker.xiaomi": { state: "home", name: "B" },
      "device_tracker.renamed": { state: "home", name: "C" },
      "device_tracker.entity_only": { state: "home", name: "Pixel Entity" },
      "device_tracker.no_name": { state: "home", name: "E" },
      "device_tracker.collision": { state: "home", name: "F" },
      "device_tracker.weird": { state: "home", name: "G" },
      "sensor.pixel": { state: "80", name: "H" },
    }
    const registry = {
      "device_tracker.pixel": { device_id: "dev_pixel", entity_name: "A" },
      "device_tracker.xiaomi": { device_id: "dev_xiaomi", entity_name: "B" },
      "device_tracker.renamed": { device_id: "renamed", entity_name: "C" },
      "device_tracker.no_name": { device_id: "unnamed", entity_name: "E" },
      "device_tracker.collision": { device_id: "collision", entity_name: "F" },
      "device_tracker.weird": { device_id: "weird", entity_name: "G" },
      "sensor.pixel": { device_id: "dev_pixel", entity_name: "H" },
    }
    const devices = {
      dev_pixel: { name: "Pixel 9" },
      dev_xiaomi: { name: "Mi device", name_by_user: "Xiaomi Phone" },
      renamed: { name: "Pixel Old", name_by_user: "Desk phone" },
      unnamed: {},
      collision: { name: "dev_pixel" },
      weird: { name: odd },
    }
    const trackers = Object.keys(states).filter((id) => id.startsWith("device_tracker."))
    const cases: [Record<string, unknown>, string[]][] = [
      [
        { device: "dev_pixel" },
        ["device_tracker.pixel", "device_tracker.collision", "sensor.pixel"],
      ],
      [{ device: "Pixel 9" }, ["device_tracker.pixel", "sensor.pixel"]],
      [{ device: "Xiaomi Phone" }, ["device_tracker.xiaomi"]],
      [{ device: "Mi device" }, []],
      [{ device: "Pixel Old" }, []],
      [{ device: "Desk phone" }, ["device_tracker.renamed"]],
      [{ device: "Pixel*" }, ["device_tracker.pixel", "sensor.pixel"]],
      [
        { device: "/Pixel|Xiaomi/" },
        ["device_tracker.pixel", "device_tracker.xiaomi", "sensor.pixel"],
      ],
      [
        { device: "/(?i)pixel|xiaomi/", domain: "device_tracker" },
        ["device_tracker.pixel", "device_tracker.xiaomi", "device_tracker.collision"],
      ],
      [{ device: "/^renamed$/" }, ["device_tracker.renamed"]],
      [
        { device: ["Pixel 9", "/Xiaomi/"] },
        ["device_tracker.pixel", "device_tracker.xiaomi", "sensor.pixel"],
      ],
      [{ device: odd }, ["device_tracker.weird"]],
      [
        { device: "*", domain: "device_tracker" },
        [
          "device_tracker.pixel",
          "device_tracker.xiaomi",
          "device_tracker.renamed",
          "device_tracker.no_name",
          "device_tracker.collision",
          "device_tracker.weird",
        ],
      ],
      [
        {
          domain: "device_tracker",
          integration: "omada_open_api",
          any: [{ device: "/Pixel|Xiaomi/" }, { name: "/Pixel|Xiaomi/" }],
        },
        ["device_tracker.pixel", "device_tracker.xiaomi", "device_tracker.entity_only"],
      ],
      [
        { domain: "device_tracker", not: { device: "/Pixel|Xiaomi/" } },
        [
          "device_tracker.renamed",
          "device_tracker.no_name",
          "device_tracker.collision",
          "device_tracker.weird",
          "device_tracker.entity_only",
        ],
      ],
    ]
    const payload = cases.map(([include]) => ({
      states,
      registry,
      devices,
      memberships: { "integration:omada_open_api": trackers },
      template: query(include),
    }))
    payload.push({
      memberships: { "integration:omada_open_api": trackers },
      states,
      registry,
      devices,
      template: normalizeConfig({
        include: { domain: "device_tracker", device: "/Pixel|Xiaomi/" },
        exclude: { device: "Xiaomi Phone" },
      }).query.template,
    })
    const output = spawnSync(
      "python3",
      [fileURLToPath(new URL("render-template.py", import.meta.url))],
      { input: JSON.stringify(payload), encoding: "utf8" }
    )
    assert.equal(output.status, 0, output.stderr)
    const results = rendered(output.stdout)
    cases.forEach(([include, expected], i) =>
      assert.deepEqual(
        results[i].result.map(({ entity }) => entity),
        expected,
        JSON.stringify(include)
      )
    )
    assert.deepEqual(
      results.at(-1)!.result.map(({ entity }) => entity),
      ["device_tracker.pixel"]
    )
  }
)
