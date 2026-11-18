import type { TemplateValue } from "./types.ts"

export function isTemplateValue(value: unknown, depth = 0): value is TemplateValue {
  if (depth > 64) return false
  if (value === null || typeof value === "string" || typeof value === "boolean") return true
  if (typeof value === "number") return Number.isFinite(value)
  if (Array.isArray(value)) return value.every((child) => isTemplateValue(child, depth + 1))
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype)
    return false
  return Object.values(value).every((child) => isTemplateValue(child, depth + 1))
}

// Jinja renders containers using Python repr, not necessarily JSON. Parse only data
// literals; never evaluate expressions or rewrite tokens inside quoted strings.
class LiteralReader {
  private offset = 0
  private text: string
  constructor(text: string) {
    this.text = text
  }

  read(): TemplateValue {
    const value = this.value(0)
    this.space()
    if (this.offset !== this.text.length) throw new SyntaxError("Trailing literal text")
    return value
  }

  private space(): void {
    while (/\s/.test(this.text[this.offset] ?? "") && this.offset < this.text.length) this.offset++
  }

  private value(depth: number): TemplateValue {
    if (depth > 64) throw new SyntaxError("Template literal is too deeply nested")
    this.space()
    const char = this.text[this.offset]
    if (char === '"' || char === "'") return this.string()
    if (char === "[") return this.list(depth + 1)
    if (char === "{") return this.object(depth + 1)
    for (const [word, value] of [
      ["True", true],
      ["False", false],
      ["None", null],
      ["true", true],
      ["false", false],
      ["null", null],
    ] as const) {
      if (this.text.startsWith(word, this.offset)) {
        this.offset += word.length
        return value
      }
    }
    const match = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(
      this.text.slice(this.offset)
    )
    if (!match) throw new SyntaxError("Not a data literal")
    const value = Number(match[0])
    if (!Number.isFinite(value)) throw new SyntaxError("Non-finite template number")
    this.offset += match[0].length
    return value
  }

  private string(): string {
    const quote = this.text[this.offset++]
    let result = ""
    while (this.offset < this.text.length) {
      const char = this.text[this.offset++]
      if (char === quote) return result
      if (char !== "\\") {
        if (char === "\n" || char === "\r") throw new SyntaxError("Unescaped literal newline")
        result += char
        continue
      }
      const escape = this.text.at(this.offset++)
      const escapes: Record<string, string> = {
        '"': '"',
        "'": "'",
        "\\": "\\",
        a: "\x07",
        b: "\b",
        f: "\f",
        n: "\n",
        r: "\r",
        t: "\t",
        v: "\x0b",
      }
      if (escape && Object.hasOwn(escapes, escape)) {
        result += escapes[escape]
        continue
      }
      const length = ({ U: 8, u: 4, x: 2 } as Record<string, number>)[escape ?? ""] ?? 0
      if (length) {
        const hex = this.text.slice(this.offset, this.offset + length)
        if (hex.length !== length || !/^[\da-f]+$/i.test(hex))
          throw new SyntaxError("Invalid literal escape")
        result += String.fromCodePoint(Number.parseInt(hex, 16))
        this.offset += length
      } else if (escape) result += `\\${escape}`
      else throw new SyntaxError("Unterminated escape")
    }
    throw new SyntaxError("Unterminated literal string")
  }

  private list(depth: number): TemplateValue[] {
    this.offset++
    const result: TemplateValue[] = []
    this.space()
    if (this.text[this.offset] === "]") {
      this.offset++
      return result
    }
    while (this.offset < this.text.length) {
      result.push(this.value(depth))
      this.space()
      const char = this.text[this.offset++]
      if (char === "]") return result
      if (char !== ",") throw new SyntaxError("Invalid list separator")
      this.space()
      if (this.text[this.offset] === "]") {
        this.offset++
        return result
      }
    }
    throw new SyntaxError("Unterminated literal list")
  }

  private object(depth: number): Record<string, TemplateValue> {
    this.offset++
    const result: Record<string, TemplateValue> = {}
    this.space()
    if (this.text[this.offset] === "}") {
      this.offset++
      return result
    }
    while (this.offset < this.text.length) {
      if (this.text[this.offset] !== '"' && this.text[this.offset] !== "'")
        throw new SyntaxError("Object keys must be strings")
      const key = this.string()
      this.space()
      if (this.text[this.offset++] !== ":") throw new SyntaxError("Invalid object separator")
      Object.defineProperty(result, key, {
        configurable: true,
        enumerable: true,
        value: this.value(depth),
        writable: true,
      })
      this.space()
      const char = this.text[this.offset++]
      if (char === "}") return result
      if (char !== ",") throw new SyntaxError("Invalid object separator")
      this.space()
      if (this.text[this.offset] === "}") {
        this.offset++
        return result
      }
    }
    throw new SyntaxError("Unterminated literal object")
  }
}

export function decodeTemplateResult(value: TemplateValue): TemplateValue {
  if (typeof value !== "string") return structuredClone(value)
  const text = value.trim()
  if (!/^(?:[[{"\d+.-]|True$|False$|None$|true$|false$|null$)/.test(text)) return text
  try {
    const parsed: unknown = JSON.parse(text)
    if (isTemplateValue(parsed)) return parsed
  } catch {
    /* Python-style Jinja results may still be valid data literals. */
  }
  // Only valid JSON-encoded strings explicitly unquote a top-level string.
  if (text.startsWith('"') || text.startsWith("'")) return text
  try {
    return new LiteralReader(text).read()
  } catch {
    return text
  }
}

export function decodeTemplateValues(values: unknown): TemplateValue[] {
  if (!Array.isArray(values) || !values.every((value) => isTemplateValue(value)))
    throw new Error("Template values must be JSON-compatible values")
  return values.map((value) => decodeTemplateResult(value as TemplateValue))
}
