import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { normalizeConfig, rendered } from "./helpers.ts"

const python = spawnSync("python3", ["-c", "import jinja2"], { encoding: "utf8" })
test(
  "state booleans match raw on/off while attribute booleans retain their types",
  {
    skip: python.status !== 0 ? "Optional check requires Python 3 with jinja2 installed" : false,
  },
  () => {
    const states = {
      "light.a": { name: "A", state: "on", attributes: { flag: true } },
      "light.b": { name: "B", state: "off", attributes: { flag: false } },
      "light.c": { name: "C", state: "unknown", attributes: { flag: "on" } },
      "light.d": { name: "D", state: "unavailable", attributes: { flag: "off" } },
      "cover.e": { name: "E", state: "open", attributes: { flag: true } },
    }
    const cases: [Record<string, unknown>, string[]][] = [
      [{ include: { state: true } }, ["light.a"]],
      [{ include: { state: false } }, ["light.b"]],
      [{ include: { state: [true, false, "unavailable"] } }, ["light.a", "light.b", "light.d"]],
      [{ include: { any: [{ state: true }, { state: "open" }] } }, ["light.a", "cover.e"]],
      [{ include: {}, exclude: { state: true } }, ["light.b", "light.c", "light.d", "cover.e"]],
      [{ include: { not: { state: [true, false] } } }, ["light.c", "light.d", "cover.e"]],
      [{ include: { "attr.flag": true } }, ["light.a", "cover.e"]],
      [{ include: { "attr.flag": false } }, ["light.b"]],
      [{ include: { "attr.flag": "on" } }, ["light.c"]],
      [{ include: { state: true, "attr.flag": false } }, []],
      [{ include: { domain: "cover", state: true } }, []],
      [{ include: { domain: "cover", state: "open" } }, ["cover.e"]],
    ]
    const output = spawnSync(
      "python3",
      [fileURLToPath(new URL("./render-template.py", import.meta.url))],
      {
        input: JSON.stringify(
          cases.map(([config]) => ({ states, template: normalizeConfig(config).query.template }))
        ),
        encoding: "utf8",
      }
    )
    assert.equal(output.status, 0, output.stderr)
    rendered(output.stdout).forEach((actual, i) =>
      assert.deepEqual(
        actual.result.map(({ entity }) => entity),
        cases[i][1],
        JSON.stringify(cases[i][0])
      )
    )
  }
)
