import { normalizeColumns } from "./layout.ts"
import { decodeTemplateValues } from "./template-values.ts"
import {
  compileCardOptions,
  renderCardOptions,
  mergeCardOptions,
  validateCardOptions,
} from "./card-templates.ts"
import { compileHeadingOptions, headingConfig, validateHeading } from "./heading.ts"
import type {
  AutoGridConfig,
  CardConfig,
  CardTemplate,
  ConfigWarning,
  Filter,
  FilterField,
  GridConfig,
  GroupConfig,
  GroupValue,
  QueryResult,
  RegistryKind,
  Include,
  Pattern,
  QueryMatch,
  Selection,
  Sort,
  SortField,
} from "./types.ts"

const entityId = /^[a-z0-9_]+\.[a-z0-9_]+$/
const domain = /^[a-z0-9_]+$/
const fieldKeys = new Set<FilterField>([
  "area",
  "floor",
  "device",
  "label",
  "domain",
  "entity",
  "type",
  "hidden",
  "state",
  "name",
  "last_changed",
  "last_updated",
  "integration",
])
const booleanKeys = new Set(["all", "any", "not"])
type NormalizedSort = Sort & { by: SortField }

function isField(field: unknown): field is FilterField {
  return (
    typeof field === "string" &&
    (fieldKeys.has(field as FilterField) || (field.startsWith("attr.") && field.length > 5))
  )
}
const sortKeys = new Set(["by", "numeric", "reverse"])

function object(value: unknown, name: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`)
  }
}

function strings(value: unknown, name: string, allowEmpty = false): string[] {
  const values = Array.isArray(value) ? value : [value]
  if ((!allowEmpty && !values.length) || values.some((v) => typeof v !== "string" || !v.trim())) {
    throw new Error(`${name} must be a non-empty string or list of non-empty strings`)
  }
  return values as string[]
}

function literal(value: Pattern): string {
  return value === null ? "none" : JSON.stringify(value)
}

function join(expressions: string[], operator: "and" | "or"): string {
  if (expressions.length) return `(${expressions.join(` ${operator} `)})`
  return operator === "and" ? "true" : "false"
}

function matchOne(target: string, value: Pattern): string {
  if (value === null) return `${target} is none`
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Filter numbers must be finite")
    return `(${target} | float(none)) == ${value}`
  }
  if (typeof value === "boolean") return `${target} == ${literal(value)}`
  if (typeof value !== "string")
    throw new Error("Filter values must be strings, numbers, booleans, or null")

  const comparison = /^(<=|>=|!=|==|<|>|=)\s*(-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)$/i.exec(
    value.trim()
  )
  if (comparison) {
    const operator = comparison[1] === "=" ? "==" : comparison[1]
    const number = Number(comparison[2])
    if (!Number.isFinite(number)) throw new Error("Filter numbers must be finite")
    return `(is_number(${target}) and (${target} | float) ${operator} ${number})`
  }

  let pattern: string | undefined
  if (value.startsWith("/") && value.endsWith("/") && value.length > 1) {
    pattern = value.slice(1, -1)
  } else if (value.includes("*")) {
    pattern = `^${value
      .split("*")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`))
      .join(".*")}$`
  }
  return pattern === undefined
    ? `${target} == ${literal(value)}`
    : `(${target} is string and ${target} is search(${literal(pattern)}))`
}

function match(target: string, value: Selection): string {
  const values = Array.isArray(value) ? value : [value]
  if (!values.length) throw new Error("Filter value lists must not be empty")
  return join(
    values.map((v) => matchOne(target, v)),
    "or"
  )
}

function membership(key: string, values: string[]): string {
  return `(${values.map((value) => `${key}_entities(${literal(value)})`).join(" + ")})`
}

function normalizeFilterAliases(
  filter: unknown,
  path: string,
  warnings: ConfigWarning[],
  depth = 0
): void {
  object(filter, "filter")
  if (depth > 20) throw new Error("Filters may nest at most 20 levels")
  const sourceKeys = new Map<string, string>()
  for (const [alias, target] of [
    ["entity_id", "entity"],
    ["or", "any"],
    ["and", "all"],
  ] as const) {
    if (!Object.hasOwn(filter, alias)) continue
    const value = alias === "entity_id" ? strings(filter[alias], alias, true) : filter[alias]
    if (Object.hasOwn(filter, target)) {
      const current = alias === "entity_id" ? strings(filter[target], target, true) : filter[target]
      if (JSON.stringify(current) !== JSON.stringify(value))
        throw new Error(`${path}: conflicting ${target} and ${alias} values`)
    } else {
      filter[target] = filter[alias]
      sourceKeys.set(target, alias)
    }
    delete filter[alias]
    warnings.push({
      code: `filter-${alias.replaceAll("_", "-")}-alias`,
      message: `Accepted as an alias for ${target}. Prefer ${target} in new configurations.`,
      path: `${path}.${alias}`,
    })
  }
  for (const key of ["all", "any", "not"] as const) {
    const children = filter[key]
    if (children === undefined) continue
    if (Array.isArray(children))
      children.forEach((child, index) =>
        normalizeFilterAliases(
          child,
          `${path}.${sourceKeys.get(key) ?? key}[${index}]`,
          warnings,
          depth + 1
        )
      )
    else if (key === "not") normalizeFilterAliases(children, `${path}.not`, warnings, depth + 1)
  }
}

function validateFilter(filter: Filter, depth = 0): void {
  object(filter, "filter")
  if (depth > 20) throw new Error("Filters may nest at most 20 levels")
  for (const [key, value] of Object.entries(filter)) {
    if (!isField(key) && !booleanKeys.has(key)) throw new Error(`Unknown filter rule: ${key}`)
    if (
      ["area", "floor", "device", "label", "domain", "entity", "type", "integration"].includes(key)
    ) {
      const values = strings(value, key, key === "entity")
      if (key === "type" && values.some((v) => !/^[a-z0-9_]+(?:\/[a-z0-9_]+)?$/.test(v))) {
        throw new Error("type must be a domain or domain/device_class, not a pattern")
      }
      if (key === "domain" && values.some((v) => !domain.test(v))) {
        throw new Error("domain must contain valid domain names, not patterns")
      }
    } else if (key === "hidden") {
      if (typeof value !== "boolean") throw new Error("hidden must be a boolean")
    } else if (key === "all" || key === "any") {
      if (!Array.isArray(value)) throw new Error(`${key} must be a list of filters`)
      value.forEach((v) => validateFilter(v, depth + 1))
    } else if (key === "not") {
      const children = Array.isArray(value) ? value : [value]
      children.forEach((child) => validateFilter(child as Filter, depth + 1))
    } else {
      match("value", value as Selection)
    }
  }
}

function predicate(
  filter: Filter,
  sets: Map<string, string>,
  stateObject = false,
  hoistedEntity = false
): string {
  const expressions: string[] = []
  const entries = Object.entries(filter)
  const rank = (key: string) => {
    if (key === "entity") return 0
    return key === "domain" ? 1 : 2
  }
  entries.sort(([left], [right]) => rank(left) - rank(right))
  for (const [key, value] of entries) {
    if (["area", "floor", "label", "integration"].includes(key)) {
      const source = membership(key, strings(value, key))
      if (!sets.has(source)) sets.set(source, `ag_members_${sets.size}`)
      expressions.push(`entity in ${sets.get(source)}`)
    } else if (key === "device") {
      expressions.push(
        join(
          [
            match("device_id(entity)", value as Selection),
            match(fieldValue("device", 0, stateObject), value as Selection),
          ],
          "or"
        )
      )
    } else if (key === "entity") {
      if (hoistedEntity) continue
      expressions.push(
        join(
          strings(value, key, true).map((id) => matchOne("entity", id)),
          "or"
        )
      )
    } else if (key === "domain") {
      expressions.push(
        `${fieldValue("domain", 0, stateObject)} in ${JSON.stringify(strings(value, key))}`
      )
    } else if (key === "type") {
      expressions.push(
        join(
          strings(value, key).map((type) =>
            matchOne(fieldValue(type.includes("/") ? "type" : "domain", 0, stateObject), type)
          ),
          "or"
        )
      )
    } else if (key === "state") {
      const values = Array.isArray(value) ? value : [value]
      expressions.push(
        match(
          fieldValue("state", 0, stateObject),
          values.map((v) => {
            if (typeof v === "boolean") return v ? "on" : "off"
            return v
          }) as Selection
        )
      )
    } else if (key === "hidden") {
      const target = fieldValue(key, 0, stateObject)
      expressions.push(value ? target : `not ${target}`)
    } else if (key === "all" || key === "any") {
      expressions.push(
        join(
          (value as Filter[]).map((f) =>
            predicate(f, sets, stateObject, hoistedEntity && key === "all")
          ),
          key === "all" ? "and" : "or"
        )
      )
    } else if (key === "not") {
      const children = Array.isArray(value) ? value : [value]
      expressions.push(
        `not ${join(
          children.map((child) => predicate(child as Filter, sets, stateObject)),
          "or"
        )}`
      )
    } else {
      expressions.push(match(fieldValue(key as FilterField, 0, stateObject), value as Selection))
    }
  }
  return join(expressions, "and")
}

type Candidates = { ids: string } | { scans: string[] }

// A restriction in an AND branch is safe; restrictions under OR/NOT aren't.
function candidates(filter: Filter): Candidates {
  for (const key of ["area", "label", "floor", "integration"] as const) {
    if (filter[key] !== undefined) return { ids: membership(key, strings(filter[key], key)) }
  }
  if (filter.entity !== undefined) {
    const ids = strings(filter.entity, "entity", true)
    if (ids.every((id) => entityId.test(id))) return { ids: JSON.stringify(ids) }
  }
  for (const child of filter.all ?? []) {
    const source = candidates(child)
    if ("ids" in source || source.scans[0] !== "states") return source
  }
  let domains: string[] = []
  if (filter.domain !== undefined) domains = strings(filter.domain, "domain")
  else if (filter.type !== undefined)
    domains = strings(filter.type, "type").map((type) => type.split("/")[0])
  return { scans: domains.length ? [...new Set(domains)].map((d) => `states.${d}`) : ["states"] }
}

function entityChecks(filter: Filter, sourceIds?: string): string[] {
  const checks: string[] = []
  if (filter.entity !== undefined) {
    const ids = strings(filter.entity, "entity", true)
    if (JSON.stringify(ids) !== sourceIds) {
      checks.push(
        join(
          ids.map((id) => matchOne("entity", id)),
          "or"
        )
      )
    }
  }
  for (const child of filter.all ?? []) checks.push(...entityChecks(child, sourceIds))
  return checks
}

// Only use per-entity tracking when a positive ID constraint is plausibly selective.
function hasSelectiveEntityCheck(filter: Filter): boolean {
  if (filter.entity !== undefined) {
    const ids = strings(filter.entity, "entity", true)
    if (
      ids.length &&
      ids.every((id) => {
        if (entityId.test(id)) return true
        if (id.startsWith("/")) return false
        return id.replace(/^[a-z0-9_*]+\./, "").replaceAll("*", "").length > 0
      })
    )
      return true
  }
  return filter.all?.some(hasSelectiveEntityCheck) ?? false
}

export function fieldValue(field: SortField, include: number, stateObject = false): string {
  switch (field) {
    case "group": {
      return `ag_groups[${include}]`
    }
    case "area": {
      return "area_name(entity)"
    }
    case "floor": {
      return "floor_name(entity)"
    }
    case "device": {
      return "device_name(entity)"
    }
    case "label": {
      return "(labels(entity) | map('label_name') | select('string') | sort | list)"
    }
    case "domain": {
      return "entity.split('.')[0]"
    }
    case "type": {
      const deviceClass = stateObject
        ? "ag_state.attributes.get('device_class')"
        : "state_attr(entity, 'device_class')"
      return `(entity.split('.')[0] ~ ('/' ~ ${deviceClass} if ${deviceClass} else ''))`
    }
    case "hidden": {
      return "is_hidden_entity(entity)"
    }
    case "integration": {
      return "(config_entry_attr(config_entry_id(entity), 'domain') if config_entry_id(entity) is not none else none)"
    }
    case "entity": {
      return "entity"
    }
    case "name": {
      return "entity_name(entity, fallback=true)"
    }
    case "state": {
      return stateObject ? "ag_state.state" : "states(entity)"
    }
    case "last_changed": {
      return stateObject
        ? "as_timestamp(ag_state.last_changed)"
        : "as_timestamp(states[entity].last_changed)"
    }
    case "last_updated": {
      return stateObject
        ? "as_timestamp(ag_state.last_updated)"
        : "as_timestamp(states[entity].last_updated)"
    }
    default: {
      if (field.startsWith("attr.") && field.length > 5) {
        return stateObject
          ? `ag_state.attributes.get(${literal(field.slice(5))})`
          : `state_attr(entity, ${literal(field.slice(5))})`
      }
      throw new Error(`Unknown field: ${field}`)
    }
  }
}

export function fieldTitle(field: SortField): string {
  if (field === "domain" || field === "type") {
    const value = field === "type" ? "group.split('/')[-1]" : "group"
    return `(${value}.split('_') | map('capitalize') | join(' '))`
  }
  if (field === "integration") {
    return "((ag_integration_names | default({})).get(group, group) if group is not none else '')"
  }
  return "(group if group is not none else '')"
}

function validateSort(sort: Sort): void {
  object(sort, "sort")
  if (Object.keys(sort).some((k) => !sortKeys.has(k))) throw new Error("Unknown sort option")
  if (sort.by !== undefined && sort.by !== "group" && !isField(sort.by)) {
    throw new Error("Unknown sort.by")
  }
  for (const key of ["numeric", "reverse"] as const) {
    if (sort[key] !== undefined && typeof sort[key] !== "boolean")
      throw new Error(`sort.${key} must be a boolean`)
  }
}

const defaultSort: NormalizedSort[] = [{ by: "name" }]

function numericSort(sort: NormalizedSort): boolean {
  return sort.numeric === true || ["hidden", "last_changed", "last_updated"].includes(sort.by)
}

function jinjaValue(value: unknown): string {
  if (value === null || value === undefined) return "none"
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value)
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  if (Array.isArray(value)) return `[${value.map(jinjaValue).join(", ")}]`
  object(value, "Template config value")
  return `{${Object.entries(value)
    .map(([key, child]) => `${JSON.stringify(key)}: ${jinjaValue(child)}`)
    .join(", ")}}`
}

function headingExpression(plan: ReturnType<typeof compileCardOptions>): string {
  const paths = new Map(plan.templates.map(({ path }, index) => [JSON.stringify(path), index]))
  const render = (value: unknown, path: (string | number)[]): string => {
    const index = paths.get(JSON.stringify(path))
    if (index !== undefined) return `ag_heading_values[${index}]`
    if (Array.isArray(value))
      return `[${value.map((child, i) => render(child, [...path, i])).join(", ")}]`
    if (value && typeof value === "object")
      return `{${Object.entries(value)
        .map(([key, child]) => `${JSON.stringify(key)}: ${render(child, [...path, key])}`)
        .join(", ")}}`
    return jinjaValue(value)
  }
  return render(plan.card, [])
}

function compileQuery(
  includes: Filter[],
  excludes: Filter[],
  sorts: NormalizedSort[],
  limit: number | undefined,
  groupConfig: GroupConfig | undefined,
  groupNames: (string | number)[],
  options: { context: Partial<CardConfig>; templates: CardTemplate[] }[]
): string {
  const headingPlan = groupConfig ? compileHeadingOptions(groupConfig.heading) : undefined
  const sets = new Map<string, string>()
  const sources = includes.map(candidates)
  const scanCounts = new Map<string, number>()
  for (const source of sources) {
    if ("scans" in source)
      for (const scan of source.scans) scanCounts.set(scan, (scanCounts.get(scan) ?? 0) + 1)
  }
  const scanLists = new Map<string, string>()
  for (const [scan, count] of scanCounts) {
    if (count > 1) scanLists.set(scan, `ag_scan_${scanLists.size}`)
  }
  const needsLifecycle = sources.some((source) => "ids" in source)
  const trackSeen = includes.length > 1
  const groups = includes.map((filter, group) => {
    const source = sources[group]
    const idChecks = entityChecks(filter, "ids" in source ? source.ids : undefined)
    // A glob can make a broad source selective: do the ID check before tracking each match.
    const stateObject = "scans" in source && !hasSelectiveEntityCheck(filter)
    const condition = predicate(filter, sets, stateObject, true)
    const exclusion = join(
      excludes.map((rule) => predicate(rule, sets, stateObject)),
      "or"
    )
    const scanned =
      "scans" in source
        ? source.scans
            .map(
              (scan) => scanLists.get(scan) ?? (source.scans.length > 1 ? `(${scan} | list)` : scan)
            )
            .join(" + ")
        : ""
    const start =
      "ids" in source
        ? [`{% for entity in (${sets.get(source.ids) ?? source.ids}) | unique | list %}`]
        : [`{% for ag_state in (${scanned}) %}`, "{% set entity = ag_state.entity_id %}"]
    const guards = [
      ...(trackSeen ? ["entity not in ns.seen"] : []),
      ...idChecks,
      ...("ids" in source ? ["states[entity] is defined and states[entity] is not none"] : []),
      condition,
      `not ${exclusion}`,
    ]
    const values = sorts.map((sort, index) => {
      const value = fieldValue(sort.by, group, stateObject)
      let prepared = `(${value} | default('', true) | string)`
      if (numericSort(sort)) prepared = `(${value} | float(none))`
      else if (sort.by === "group")
        prepared = `([1, (${value} | lower)] if ${value} is string else [0, ${value}])`
      return `'sort${index}': ${prepared}`
    })
    const fields = [
      `'entity': entity`,
      `'group': ${group}`,
      ...values,
      ...(groupConfig ? ["'bucket': ag_value", "'bucket_key': ag_key"] : []),
    ].join(", ")
    return [
      ...start,
      `{% if ${join(guards, "and")} %}`,
      ...(groupConfig
        ? [
            `{% set ag_value = ${fieldValue(groupConfig.by, group, stateObject)} %}`,
            "{% if ag_value is number and ag_value is not boolean and ag_value == (ag_value | int) %}{% set ag_value = ag_value | int %}{% endif %}",
            "{% set ag_key = ag_group_key(ag_value) %}",
          ]
        : []),
      ...(trackSeen ? ["{% set ns.seen = ns.seen + [entity] %}"] : []),
      `{% set ns.rows = ns.rows + [{${fields}}] %}`,
      "{% endif %}",
      "{% endfor %}",
    ].join("\n")
  })
  // Counting states tracks additions/removals, not ordinary changes or a full-state iteration.
  const lines = needsLifecycle ? ["{% set ag_lifecycle = states | count %}"] : []
  lines.push(...[...sets].map(([expression, name]) => `{% set ${name} = ${expression} %}`))
  lines.push(...[...scanLists].map(([scan, name]) => `{% set ${name} = ${scan} | list %}`))
  options.forEach(({ templates }, group) =>
    templates.forEach(({ source }, index) => {
      lines.push(
        `{% macro ag_option_${group}_${index}(entity, config, group, group_name, group_count) -%}${source}{%- endmacro %}`
      )
    })
  )
  const matchLines = (row: string): string[] => {
    const result = [`{% set ag_match = {'entity': ${row}.entity, 'group': ${row}.group} %}`]
    options.forEach(({ context, templates }, group) => {
      if (!templates.length) return
      result.push(
        `{% if ${row}.group == ${group} %}`,
        `{% set config = dict(${jinjaValue(context)}, entity=${row}.entity) %}`,
        `{% set ag_values = [${templates.map((_, index) => `(ag_option_${group}_${index}(${row}.entity, config, group, group_name, group_count) | trim)`).join(", ")}] %}`,
        "{% set ag_match = dict(ag_match, values=ag_values) %}",
        "{% endif %}"
      )
    })
    return result
  }
  if (sorts.some((sort) => sort.by === "group") || groupConfig?.by === "group") {
    lines.push(`{% set ag_groups = [${groupNames.map(literal).join(", ")}] %}`)
  }
  if (groupConfig) {
    // JSON-style keys keep types distinct and normalize equal nested numeric values.
    lines.push(
      "{% macro ag_group_key(value) -%}",
      "{%- if value is mapping -%}{",
      "{%- for key in value | sort(case_sensitive=true) -%}{{ ',' if not loop.first }}{{ key | to_json }}:{{ ag_group_key(value[key]) }}{%- endfor -%}}",
      "{%- elif value is sequence and value is not string -%}[{%- for item in value -%}{{ ',' if not loop.first }}{{ ag_group_key(item) }}{%- endfor -%}]",
      "{%- elif value is number and value is not boolean and value == (value | int) -%}{{ value | int | to_json }}",
      "{%- else -%}{{ value | to_json }}{%- endif -%}",
      "{%- endmacro %}"
    )
  }
  lines.push(`{% set ns = namespace(rows=[]${trackSeen ? ", seen=[]" : ""}) %}`, ...groups)
  if (sorts.length) {
    // Stable least-significant-first sorts preserve higher-priority keys and deterministic ties.
    lines.push("{% set ns.rows = ns.rows | sort(attribute='entity') %}")
    for (let i = sorts.length - 1; i >= 0; i--) {
      const sort = sorts[i]
      if (numericSort(sort)) {
        lines.push(
          `{% set valid = ns.rows | rejectattr('sort${i}', 'none') | list %}`,
          `{% set missing = ns.rows | selectattr('sort${i}', 'none') | list %}`,
          `{% set ns.rows = (valid | sort(attribute='sort${i}', reverse=${sort.reverse ? "true" : "false"})) + missing %}`
        )
      } else {
        lines.push(
          `{% set ns.rows = ns.rows | sort(attribute='sort${i}', reverse=${sort.reverse ? "true" : "false"}) %}`
        )
      }
    }
  }
  lines.push(`{% set ag_rows = ns.rows${limit === undefined ? "" : `[:${limit}]`} %}`)
  if (groupConfig) {
    lines.push(
      ...headingPlan!.templates.map(
        ({ source }, index) =>
          `{% macro ag_heading_${index}(entity, config, group, group_name, group_count) -%}${source}{%- endmacro %}`
      ),
      "{% set group_count = ag_rows | map(attribute='bucket_key') | unique(case_sensitive=true) | list | count %}",
      "{% set sections = namespace(rows=[], keys=[]) %}",
      "{% for row in ag_rows %}",
      "{% if row.bucket_key not in sections.keys %}",
      "{% set sections.keys = sections.keys + [row.bucket_key] %}",
      "{% set group = row.bucket %}",
      `{% set group_name = ${fieldTitle(groupConfig.by)} %}`,
      "{% set members = namespace(rows=[]) %}",
      "{% for member in ag_rows | selectattr('bucket_key', 'eq', row.bucket_key) %}",
      ...matchLines("member"),
      "{% set members.rows = members.rows + [ag_match] %}",
      "{% endfor %}",
      `{% set config = dict(${jinjaValue(headingPlan!.context)}, entity=row.entity) %}`,
      `{% set ag_heading_values = [${headingPlan!.templates.map((_, index) => `(ag_heading_${index}(row.entity, config, group, group_name, group_count) | trim)`).join(", ")}] %}`,
      `{% set ag_heading = ${headingExpression(headingPlan!)} %}`,
      "{% set sections.rows = sections.rows + [{'key': row.bucket_key, 'value': group, 'title': ag_heading.get('heading', ''), 'heading': ag_heading, 'matches': members.rows}] %}",
      "{% endif %}",
      "{% endfor %}",
      "{{ sections.rows }}"
    )
  } else {
    lines.push(
      "{% set group = none %}{% set group_name = '' %}{% set group_count = 0 %}",
      "{% set result = namespace(rows=[]) %}",
      "{% for row in ag_rows %}",
      ...matchLines("row"),
      "{% set result.rows = result.rows + [ag_match] %}",
      "{% endfor %}",
      "{{ result.rows }}"
    )
  }
  return lines.join("\n")
}

export function normalizeMatches(value: unknown, groupCount: number): QueryMatch[] {
  if (!Array.isArray(value))
    throw new Error("The entity query must return a list of entity/group matches")
  const seen = new Set<string>()
  const matches: QueryMatch[] = []
  for (const row of value) {
    object(row, "Query match")
    if (
      typeof row.entity !== "string" ||
      !entityId.test(row.entity) ||
      typeof row.group !== "number" ||
      !Number.isInteger(row.group) ||
      row.group < 0 ||
      row.group >= groupCount
    ) {
      throw new Error("Invalid entity ID or include group in query result")
    }
    if (!seen.has(row.entity)) {
      seen.add(row.entity)
      matches.push({
        entity: row.entity,
        group: row.group,
        ...(row.values === undefined ? {} : { values: decodeTemplateValues(row.values) }),
      })
    }
  }
  return matches
}

function groupKey(value: unknown, depth = 0): string {
  if (depth > 20) throw new Error("Group values may nest at most 20 levels")
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  )
    return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((v) => groupKey(v, depth + 1)).join(",")}]`
  object(value, "Group value")
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${groupKey(value[key], depth + 1)}`)
    .join(",")}}`
}

const fieldRegistries: Partial<Record<SortField, RegistryKind[]>> = {
  area: ["entity", "device", "area"],
  device: ["entity", "device"],
  floor: ["entity", "device", "area", "floor"],
  hidden: ["entity"],
  integration: ["entity", "integration"],
  label: ["entity", "label"],
  name: ["entity", "device"],
}
const allRegistries: RegistryKind[] = ["entity", "device", "area", "floor", "label", "integration"]

function registryDependencies(
  includes: Filter[],
  excludes: Filter[],
  sorts: NormalizedSort[],
  group: GroupConfig | undefined,
  plans: ReturnType<typeof compileCardOptions>[]
): RegistryKind[] {
  const result = new Set<RegistryKind>()
  const field = (key: SortField) => fieldRegistries[key]?.forEach((kind) => result.add(kind))
  const filter = (value: Filter) => {
    for (const [key, child] of Object.entries(value)) {
      if (key === "all" || key === "any" || key === "not") {
        for (const nested of Array.isArray(child) ? child : [child]) filter(nested as Filter)
      } else field(key as FilterField)
    }
  }
  includes.forEach(filter)
  excludes.forEach(filter)
  sorts.forEach((sort) => field(sort.by))
  if (group) field(group.by)
  const headingTemplates = group ? compileHeadingOptions(group.heading).templates : []
  const custom =
    headingTemplates.some(
      ({ source }) => source !== "{{ group_name | string | to_json }}" && /{{|{%/.test(source)
    ) || plans.some((plan) => plan.templates.some(({ source }) => /{{|{%/.test(source)))
  if (custom) allRegistries.forEach((kind) => result.add(kind))
  return allRegistries.filter((kind) => result.has(kind))
}

export function normalizeResult(value: unknown, config: GridConfig): QueryResult {
  if (!config.query.group) return { matches: normalizeMatches(value, config.query.cards.length) }
  if (!Array.isArray(value)) throw new Error("The grouped query must return a list of sections")
  const keys = new Set<string>(),
    entities = new Set<string>()
  const sections = value.map((section) => {
    object(section, "Query section")
    if (typeof section.title !== "string") throw new Error("Group title must be a string")
    object(section.heading, "Group heading")
    const plan = compileHeadingOptions(config.query.group!.heading)
    const values = plan.templates.map(({ path }) => {
      let child: unknown = section.heading
      for (const part of path)
        child = (child as Record<string | number, unknown> | undefined)?.[part]
      return child
    })
    const heading = validateHeading(
      renderCardOptions(section.heading as CardConfig, plan.templates, decodeTemplateValues(values))
    )
    const key = groupKey(section.value)
    if (keys.has(key)) throw new Error("Duplicate group in query result")
    keys.add(key)
    const matches = normalizeMatches(section.matches, config.query.cards.length)
    if (!matches.length) throw new Error("Query sections must not be empty")
    for (const row of matches) {
      if (entities.has(row.entity)) throw new Error("Entity appears in multiple groups")
      entities.add(row.entity)
    }
    return {
      heading,
      key,
      matches,
      title: typeof heading.heading === "string" ? heading.heading : "",
      value: section.value as GroupValue,
    }
  })
  return { matches: sections.flatMap((section) => section.matches), sections }
}

function filters<T extends Filter>(value: T | T[], name: string): T[] {
  const result = Array.isArray(value) ? value : [value]
  for (const filter of result) object(filter, name)
  return result
}

function normalizeGroup(value: AutoGridConfig["group"]): GroupConfig | undefined {
  if (value === undefined || value === false) return undefined
  if (value === true) return normalizeGroup({ by: "group" })
  const group = typeof value === "string" ? { by: value } : value
  object(group, "group")
  if ("title" in group) throw new Error("group.title is no longer supported; use group.heading")
  if (Object.keys(group).some((key) => !["by", "heading", "$heading"].includes(key)))
    throw new Error("Unknown group option")
  const by = group.by === undefined ? "group" : group.by
  if (by !== "group" && !isField(by)) throw new Error("Unknown group.by")
  const heading = headingConfig(
    group.heading === undefined && group.$heading === undefined
      ? { $heading: "{{ group_name | string | to_json }}" }
      : {
          $heading: group.$heading as string | undefined,
          heading: group.heading as AutoGridConfig["heading"],
        },
    "subtitle"
  ) ?? { heading: "", heading_style: "subtitle", type: "heading" }
  return { by, heading }
}

export function normalizeConfig(input: AutoGridConfig): GridConfig {
  object(input, "Auto Grid configuration")
  // YAML may omit required fields despite the public TypeScript contract.
  const config: Partial<AutoGridConfig> = structuredClone(input)
  const heading = headingConfig(config)
  const warnings: ConfigWarning[] = []
  for (const old of ["filter", "entities", "options"]) {
    if (old in config)
      throw new Error(`${old} is no longer supported; use include/exclude and card`)
  }
  const columns = normalizeColumns(config.columns)
  if (config.limit !== undefined && (!Number.isInteger(config.limit) || config.limit < 0)) {
    throw new Error("limit must be a non-negative integer")
  }
  for (const key of ["square", "show_empty"] as const) {
    if (config[key] !== undefined && typeof config[key] !== "boolean")
      throw new Error(`${key} must be a boolean`)
  }
  if (config.include === undefined) throw new Error("include is required")
  const includes = filters<Include>(config.include, "include")
  const excludes = config.exclude === undefined ? [] : filters(config.exclude, "exclude")
  let card: CardConfig = { type: "tile" }
  if (config.card !== undefined) {
    validateCardOptions(config.card)
    card = mergeCardOptions(card, config.card)
  }
  const includeFilters: Filter[] = []
  const groupNames: (string | number)[] = []
  const cards = includes.map((include, index) => {
    const { card: override, group, ...filter } = include
    if (group !== undefined && typeof group !== "string")
      throw new Error("include.group must be a string")
    groupNames.push(group ?? index)
    normalizeFilterAliases(filter, `include[${index}]`, warnings)
    validateFilter(filter)
    includeFilters.push(filter)
    if (override !== undefined) validateCardOptions(override)
    return mergeCardOptions(card, override ?? {})
  })
  excludes.forEach((exclude, index) => {
    normalizeFilterAliases(exclude, `exclude[${index}]`, warnings)
    validateFilter(exclude)
  })
  const plans = cards.map(compileCardOptions)
  const group = normalizeGroup(config.group)
  let sorts: (Sort | SortField)[] = defaultSort
  if (config.sort !== undefined) sorts = Array.isArray(config.sort) ? config.sort : [config.sort]
  const normalizedSorts = sorts.map((sort) => {
    const normalized = typeof sort === "string" ? { by: sort } : sort
    validateSort(normalized)
    return { ...normalized, by: normalized.by ?? "name" }
  })
  return {
    card,
    columns,
    heading,
    query: {
      cards: plans.map((plan) => plan.card),
      group,
      registries: registryDependencies(includeFilters, excludes, normalizedSorts, group, plans),
      template: compileQuery(
        includeFilters,
        excludes,
        normalizedSorts,
        config.limit,
        group,
        groupNames,
        plans
      ),
      templates: plans.map((plan) => plan.templates),
    },
    show_empty: config.show_empty ?? false,
    square: config.square ?? false,
    warnings,
  }
}
