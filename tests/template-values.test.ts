import assert from "node:assert/strict"
import { test } from "node:test"
import {
  decodeTemplateResult,
  decodeTemplateValues,
  isTemplateValue,
} from "../src/template-values.ts"
import { compileCardOptions, renderCardOptions } from "../src/card-templates.ts"
import type { TemplateValue } from "../src/types.ts"

const cases: [string, TemplateValue][] = [
  ["123", 123],
  ["-1.25", -1.25],
  ["+.5", 0.5],
  ["1e3", 1000],
  ["True", true],
  ["False", false],
  ["None", null],
  ["true", true],
  ["false", false],
  ["null", null],
  ["[]", []],
  ["{}", {}],
  ["[True, False, None]", [true, false, null]],
  ['[true, false, null, "123"]', [true, false, null, "123"]],
  ["['light.a', 'light.b',]", ["light.a", "light.b"]],
  [
    "{'enabled': True, 'count': 3, 'values': ['123', 'True', '[1]'],}",
    { enabled: true, count: 3, values: ["123", "True", "[1]"] },
  ],
  [
    String.raw`{'quotes': 'It\'s fine', 'path': 'C:\\data', 'line': 'a\nb', 'snow': '\u2603', 'emoji': '\U0001f600', 'zero': '\x00'}`,
    {
      quotes: "It's fine",
      path: String.raw`C:\data`,
      line: "a\nb",
      snow: "☃",
      emoji: "😀",
      zero: "\0",
    },
  ],
  ["  Office  ", "Office"],
  ["", ""],
  [" on ", "on"],
]

test("template results decode JSON and Jinja data literals into native values", () => {
  for (const [input, expected] of cases)
    assert.deepEqual(decodeTemplateResult(input), expected, input)
})

test("a JSON-encoded string is decoded exactly once, including escapes", () => {
  for (const value of [
    "123",
    "true",
    "None",
    "[1, 2]",
    '{"a": 1}',
    '"quoted"',
    "Line 1\nLine 2",
    String.raw`C:\path`,
    "  padded  ",
    "☃",
  ]) {
    assert.equal(decodeTemplateResult(JSON.stringify(value)), value)
    assert.equal(decodeTemplateResult(JSON.stringify(JSON.stringify(value))), JSON.stringify(value))
  }
  assert.equal(decodeTemplateResult("'123'"), "'123'")
})

test("nested strings are never recursively decoded", () => {
  const input = { list: ["123", "True", "null", '"quoted"'], dict: { a: "[1]" } }
  assert.deepEqual(decodeTemplateResult(JSON.stringify(input)), input)
  assert.deepEqual(decodeTemplateResult(input), input)
})

test("unsupported or malformed expressions stay text and are never executed", () => {
  for (const text of [
    "[",
    "{'a':",
    "[1] trailing",
    "[1 + 2]",
    "{'a': Math.random()}",
    "__import__('os')",
    "NaN",
    "Infinity",
    "1e999",
    "{1: 'a'}",
    String.raw`{'a': '\uZZZZ'}`,
    "(1, 2)",
    "{1, 2}",
    String.raw`"bad\q"`,
  ])
    assert.equal(decodeTemplateResult(text), text)
  const nested = `${"[".repeat(70)}0${"]".repeat(70)}`
  assert.equal(decodeTemplateResult(nested), nested)
})

test("object literal keys cannot mutate prototypes", () => {
  for (const input of [
    '{"__proto__": {"polluted": true}}',
    "{'__proto__': {'polluted': True}, 'constructor': {'prototype': {'polluted': True}}}",
  ]) {
    const decoded = decodeTemplateResult(input)
    assert.equal(typeof decoded, "object")
    assert.equal(Object.hasOwn(decoded as object, "__proto__"), true)
    assert.equal(Object.hasOwn(Object.prototype, "polluted"), false)
  }
})

test("transport values validate JSON-compatible data, then decode once", () => {
  assert.deepEqual(decodeTemplateValues(["True", "123", '"123"', null, ["123"], { count: 1 }]), [
    true,
    123,
    "123",
    null,
    ["123"],
    { count: 1 },
  ])
  for (const values of [undefined, {}, [undefined], [Infinity], [NaN], [new Date()], [() => 1]])
    assert.throws(() => decodeTemplateValues(values), /JSON-compatible/)
  const cyclic: Record<string, unknown> = {}
  cyclic.self = cyclic
  assert.equal(isTemplateValue(cyclic), false)
})

test("rendered arrays and objects are isolated per child and ordinary options stay literal", () => {
  const plan = compileCardOptions({
    type: "test",
    $features: "{{ features }}",
    $enabled: "{{ true }}",
    name: "123",
    other: "[1]",
  })
  const values = decodeTemplateValues(["[{'type': 'toggle', 'enabled': True}]", "True"])
  const a = renderCardOptions(plan.card, plan.templates, values)
  const b = renderCardOptions(plan.card, plan.templates, values)
  assert.deepEqual(a.features, [{ type: "toggle", enabled: true }])
  assert.equal(a.enabled, true)
  assert.equal(a.name, "123")
  assert.equal(a.other, "[1]")
  const features = a.features as { type: string }[]
  features[0].type = "changed"
  assert.deepEqual(b.features, [{ type: "toggle", enabled: true }])
  assert.deepEqual(values[0], [{ type: "toggle", enabled: true }])
})
