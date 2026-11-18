# ⚙️ Configuration

[← README](../README.md)

The complete YAML reference for `custom:auto-grid`.

- [Options](#options), [layouts](#grid-and-stack-layouts), and the [visual editor](#visual-editor)
- [Selection](#include-groups-and-global-exclusions) and [filter rules](#filter-rules)
- [Sorting and limits](#sorting-and-limits)
- [Heading](#heading) and [grouping](#grouping)
- [Card-option templates](#explicit-card-option-templates)

## Options

| Option       | Default          | Description                                                              |
| ------------ | ---------------- | ------------------------------------------------------------------------ |
| `include`    | Required         | A selection filter or list; groups may override `card`                   |
| `exclude`    | —                | A global exclusion filter or list                                        |
| `card`       | `{ type: tile }` | Shared child-card configuration; `entity` is reserved                    |
| `heading`    | —                | Native heading config or text shorthand; defaults to Title style         |
| `columns`    | `2`              | Fixed count (1–24), `all` for one row, or responsive `auto` / `180px`    |
| `square`     | `false`          | Square cells, like the native grid card                                  |
| `show_empty` | `false`          | Show loading/empty placeholders instead of hiding the grid               |
| `group`      | `false`          | Boolean, field name, or `{ by, heading }` for visual grouping            |
| `sort`       | `name`           | Sort string/object or mixed priority-ordered list; `[]` disables sorting |
| `limit`      | —                | Maximum results after sorting, before grouping                           |

### Grid and stack layouts

- `columns: 1`: a vertical stack.
- `columns: 2` (the default): a two-column grid, wrapping into additional rows.
- `columns: all`: one equal-width column per rendered card, like a horizontal stack.
- `columns: auto`: responsive wrapping with a 140px minimum card width.
- `columns: 180px`: responsive wrapping with an explicit positive pixel minimum.

```yaml
type: custom:auto-grid
columns: auto
include:
  area: office
  type: light
```

Responsive modes use CSS `auto-fill`, reserving empty tracks so sparse groups
keep consistent card widths. The minimum is capped at the container width: a 300px
minimum on a narrow phone becomes one full-width column rather than overflowing.
Only positive pixel lengths are supported, including decimals; other CSS units and
expressions are rejected. Fixed counts must be between 1 and 24. Numeric strings
such as `"3"` are accepted as counts; use `180px`, not `180`, for a minimum width.

Each visual group lays out independently. Changing width, layout mode, or membership
preserves retained child cards and the backend subscription. Responsive sizing is
reported to HA as the available width changes. Use a scoped selection or `limit` to
avoid an overly crowded `all` row. `square` applies in every mode.

This is an equal-column grid, not the full Sections layout engine. It does not
implement per-card column/row spans or infer pixel widths from child Sections sizing
hints. Grid spacing can be customized with the `--auto-grid-gap` CSS property;
otherwise it uses HA's `--grid-card-gap` or `8px`.

## Visual Editor

The editor has four independent panels: **Grid**, **Heading**, **Selection**, and
**Card**. Selection starts expanded; the others start collapsed. Panel state and
YAML drafts survive edits in other panels. Opening the editor does not add default
configuration values.

Selection YAML owns only `include`, `exclude`, `group`, `sort`, and `limit`.
Omitting a key removes that setting, but a valid selection must still contain
`include`. Unknown root fields and invalid rules are rejected. Per-include card
options stay in this YAML; the Card panel edits only the global `card`.

The native card editor uses the first matching entity as a capability sample.
Choosing another entity makes an editor-local override; otherwise the sample
follows the current results. With no matches, it is unset. Samples are never saved
as `card.entity` and do not affect selection.

Card YAML can change the card type. `$` properties force YAML mode until removed;
ordinary Mushroom Jinja strings pass through untouched. Cards without a usable
visual editor fall back to YAML without changing saved configuration. Invalid
card, selection, and layout drafts show inline errors and do not replace the last
valid configuration.

Safe compatibility conversions produce configuration warnings above the rendered
card in preview, including the outer YAML editor. Each warning identifies the
configuration path and explains the recovery. The card still renders, and warnings
are hidden on the normal dashboard. Configuration is normalized internally without
rewriting saved YAML. Unknown filter rules and ambiguous/conflicting values remain
errors; Auto Grid does not guess misspellings or strip arbitrary child-card options.

Use HA's outer **Show code editor** for other root fields, such as visibility or
Styler settings. Inline editors preserve those fields.

## Include groups and global exclusions

`include` is required and accepts one filter or a list of filters. Rules within a
filter are **AND**; include groups are **OR**. Each entity produces only one card:
**the first matching include group wins**.

An include group may override the global `card`. Nested objects and arrays replace
inherited values; they are not recursively merged. Each child gets an independent
copy. The `entity` field is reserved and cannot be configured in `card`, including as
`$entity`. For templated options, overrides use the destination key:
a per-include `$name` overrides a global `name`, and a per-include `name` replaces
an inherited `$name`.

`exclude` accepts a filter or list of filters. Matching **any** exclusion removes the
entity globally, regardless of which include group selected it. A `not` rule inside
an include group excludes only from that group; a later group can still select it.
Exclusions and nested filters cannot contain card configuration or a group label.
Include rules can additionally set `group: Lights` to name their synthetic group;
without a name, the group value is the zero-based include-rule index.

```yaml
type: custom:auto-grid
card:
  type: tile
  name:
    type: entity
include:
  - area: pool
    domain: light
    card:
      features:
        - type: light-brightness
  - area: pool
    type: binary_sensor/problem
exclude:
  - entity: "*_diagnostic"
  - state: unavailable
```

Use `entity` in filters, sorting, and grouping. Explicit entities still go through
the backend query, so the same sorting, exclusions, and include-group semantics apply:

```yaml
type: custom:auto-grid
include:
  entity:
    - light.pool
    - light.hall
sort: []
```

`sort: []` preserves the supplied order. `include: []` selects nothing; `include: {}`
selects every entity with a state. Be mindful of HA's rate limits for broad queries.

### JSON entity lists

`entity` also accepts a string containing a JSON array of non-empty strings:

```yaml
include:
  entity: '["sensor.b", "sensor.a"]'
sort: []
```

This is equivalent to a normal YAML list. Duplicates are removed, and `sort: []`
preserves list order.
Glob/regex entries still use normal matching. Empty lists (`entity: []` or `"[]"`)
select nothing; excluding an empty list removes nothing, and negating it matches all
otherwise eligible entities.

Only `entity` parses JSON this way. Strings starting with `[` after whitespace
must be valid JSON arrays; malformed JSON and non-string/empty entries produce a
configuration error. Python-style `['sensor.foo']` is not JSON—use `| to_json`.
Other fields and `$` template output types are unchanged.

This lets an outer Auto Grid supply a generated selection to an inner grid without
turning arbitrary card templates into native lists:

```yaml
type: custom:auto-grid
columns: 1
include:
  entity: "pyscript.alert_*"
card:
  type: custom:auto-grid
  columns: 2
  sort: []
  include:
    # First, the alert itself
    - $entity: "{{ entity }}"
      card:
        type: tile
    # Then the related IDs, in their original order
    - $entity: >-
        {{ state_attr(entity, 'entities') | default([], true) | to_json }}
      card:
        type: custom:mushroom-entity-card
```

The outer grid resolves both `$entity` values in the parent entity's context. The
inner grid parses the resulting JSON string normally. Missing/empty `entities` leaves
just the alert header.

## Filter rules

Lists of values for a single rule match any value (**OR**). Home Assistant evaluates
the filters on the backend.

| Rule           | Value                                                                |
| -------------- | -------------------------------------------------------------------- |
| `area`         | Area ID/name, or a list                                              |
| `floor`        | Floor ID/name, or a list                                             |
| `device`       | Device ID or effective name; exact, wildcard, `/regex/`, or a list   |
| `label`        | Label ID/name, or a list                                             |
| `domain`       | Exact domain name, or a list, e.g. `light`                           |
| `entity`       | Exact ID, wildcard, `/regex/`, native list, or JSON-array string     |
| `type`         | HA-style entity type: domain or domain/device_class, or a list       |
| `hidden`       | Boolean; whether HA's entity registry marks the entity as hidden     |
| `state`        | Exact value, wildcard, `/regex/`, numeric comparison, or a list      |
| `name`         | Entity's own name, with device fallback and the same matching syntax |
| `last_changed` | Unix timestamp in seconds; numeric value/comparison or a list        |
| `last_updated` | Unix timestamp in seconds; numeric value/comparison or a list        |
| `integration`  | Integration domain or config entry title, or a list                  |
| `attr.<name>`  | Match a literal entity attribute using the same matching syntax      |
| `all`          | List of filters, all must match                                      |
| `any`          | List of filters, at least one must match                             |
| `not`          | A filter that must not match, or a list where none may match         |

Area/floor/label membership uses HA's corresponding `*_entities()` helper semantics.
An area includes entities assigned through a device.

`device` matches either HA's `device_id(entity)` or its effective `device_name(entity)`.
The effective name prefers a user-assigned name; after a rename, the original name is
not also matched. IDs and names use the same exact/glob/regex syntax, and lists match
any entry. Entities without a device do not match.

```yaml
include:
  domain: device_tracker
  integration: omada_open_api
  any:
    - device: /Pixel|Xiaomi/
    - name: /Pixel|Xiaomi/
```

A device-only query may be subject to HA's broad-template rate limit. Add an
integration, area, entity ID, or domain/type rule to scope it. Device sorting and
grouping use the effective display name.

`type` mirrors HA's entity-type selection: a bare domain matches every entity in that
domain, even when it has a device class. A qualified type matches both parts exactly:

```yaml
include:
  area: office
  type:
    - light
    - binary_sensor/battery
group: type
```

- `type: sensor` matches all sensors, including battery and temperature sensors.
- `type: sensor/battery` matches only battery sensors.
- `type` values are exact, not globs or regexes. Candidate selection is restricted
  to the listed domains without scanning all states.
- Type sorting/grouping uses the most specific value: `sensor/battery`,
  `sensor/temperature`, or just `sensor` when it has no device class.
- Type headings use the device class (`Battery`) or the domain (`Sensor`). Domain/type
  titles split underscores and capitalize each part: `carbon_monoxide` becomes
  `Carbon Monoxide`, `binary_sensor` becomes `Binary Sensor`. This is formatting, not
  localization; raw grouping/filtering/sorting values remain unchanged.
  `sensor/battery` and `binary_sensor/battery` stay separate groups even though both
  headings read `Battery`.

`domain` remains available for domain-only grouping/filtering. For device-class
matching across domains, use `attr.device_class: battery`. The old `device_class`
shorthand has been removed; use `type: sensor/battery` or `attr.device_class` instead.
All rules still combine with AND, so contradictory type/domain/attribute constraints
match nothing.

`hidden: true` matches entities hidden by either the user or an integration.
`hidden: false` matches entities that are not hidden, including entities without a
registry entry. Omit the rule to ignore hidden status (the default). It compiles to
HA's `is_hidden_entity()` helper, not a state attribute or dashboard visibility check.
Auto Grid watches relevant registry edits so changes can refresh the selection.

`integration` uses HA's `integration_entities()` helper, including its config-entry
title matching semantics. It also narrows the initial candidate list, so an
integration-scoped query does not scan every state. Names are exact, not regexes.

`last_changed` and `last_updated` read the state's timestamps as Unix seconds:

```yaml
include:
  integration: mqtt
  last_updated: ">= 1767225600" # January 1, 2026, UTC
sort:
  - by: last_updated
    reverse: true
```

These are absolute timestamps, not ages; relative-time expressions such as
`"< 5 m ago"` are not supported. Registry `entity_category`/`category` remains deferred.

To exclude hidden entities from every include group:

```yaml
exclude:
  hidden: true
```

Strings match exactly unless they contain `*` or are delimited with `/` for a Python
regular expression. Globs are anchored, `*` matches any sequence, and other characters
are literal. Matching is case-sensitive. Numeric comparison strings support
`<`, `<=`, `>`, `>=`, `=`, `==`, and `!=`; non-numeric entity values do not match these.
Numeric YAML values compare numerically; booleans and `null` are useful for attributes.
Everything after `attr.` is a literal attribute name, including dots and colons:
`attr.some.integration_key` reads the attribute named `some.integration_key`, not a
nested path. The same notation works for sorting.

```yaml
include:
  domain: sensor
  attr.device_class: battery
  attr.battery_level: "< 20"
sort:
  - group
  - by: attr.battery_level
    numeric: true
  - name
```

`not` accepts one filter or a list interpreted as `not any`. These differ:

```yaml
# Reject entities that are hidden OR unavailable
not:
  - hidden: true
  - state: unavailable

# Reject only entities that are BOTH hidden AND unavailable
not:
  hidden: true
  state: unavailable
```

`not: []` rejects nothing; `not: {}` rejects everything. Nested `any`, `all`, and
`not` rules work in both includes and exclusions.

For `state` only, YAML booleans normalize to HA's raw state strings: `true` → `"on"`,
`false` → `"off"`. This also handles parsers treating unquoted `on`/`off` as booleans.
It applies in includes, exclusions, nested rules, and lists such as
`state: [true, unavailable]`. Attribute booleans remain actual boolean comparisons.
This is not an "active" abstraction: covers still need `state: open`, locks need
`state: unlocked`, and so on. Quoted `"on"`/`"off"` are always unambiguous.

For low batteries:

```yaml
type: custom:auto-grid
include:
  label: batteries
  type: sensor/battery
  state: "< 20"
sort:
  by: state
  numeric: true
limit: 8
```

Raw selection templates, nested attribute paths, translated-state matching, relative-time
rules, and per-group sorting/pagination are not implemented. Heading and explicit `$`
card-option templates are supported. Unknown filter rules
are rejected. The earlier `filter`, `entities`, and `options` fields have been replaced
by `include`/`exclude` and `card`; old configurations produce a migration error.
The previous `attributes: { battery: ... }` notation is now `attr.battery: ...`;
`sort: { by: attribute, attribute: battery }` is now `sort: attr.battery` (or
`sort: { by: attr.battery, numeric: true }` for numeric ordering).

## Sorting and limits

The default is:

```yaml
sort: name
```

Include order controls first-match selection and card overrides, not default ordering.

An explicit `sort` **replaces** the default. A string such as `sort: name` is shorthand
for `sort: { by: name }`. A single string or object is shorthand for a one-element list.
Lists can mix strings and objects and are in priority order: the first entry is the
primary key, with subsequent entries breaking ties.

```yaml
# Alphabetical across all groups, without include grouping
sort: name
```

```yaml
# Named include groups, then descending numeric state within each group
sort:
  - group
  - by: state
    numeric: true
    reverse: true
```

Every filter field is also sortable: `area`, `floor`, `device`, `label`, `domain`,
`entity`, `type`, `hidden`, `state`, `name`, `last_changed`, `last_updated`,
`integration`, and `attr.<name>`. The synthetic `group` field is the winning include's
label or fallback index; it replaces the earlier `sort: include` spelling. Boolean operators `all`/`any`/`not` are not fields and cannot be sorted.

Use an object to set independent `numeric` and `reverse` flags for each sort. If `by`
is omitted from an object, it defaults to `name` (for example, `sort: { reverse: true }`).
Hidden and timestamp sorts are numeric automatically; hidden sorts visible
entities first unless reversed. String sorts are case-insensitive. Missing/non-numeric
values in numeric sorts go last in either direction.

Area/floor/device sorting uses resolved display names rather than IDs. Label sorting
uses the canonical, alphabetically sorted list of the entity's assigned label names,
compared as text; entities without labels use an empty value. Integration sorting uses
the config entry's domain, not its title. Entities without a config entry (such as
some YAML-defined entities) have no integration sort value, even though HA can still
select them using `integration_entities()`. Missing textual values compare as empty
strings.

Whenever sorting is enabled, entity ID is the final ascending tie-breaker for
predictable ordering. **`sort: []` disables all sorting**, including that fallback,
and retains include-group order followed by candidate order within each group.

Both the `name` filter and `sort.by: name` use HA's
`entity_name(entity, fallback=true)`: the entity's own registry name, falling back to
its device name when it has no own name and delegates naming to that device. Entities
without registry entries use the state object's name. This follows HA's modern naming
model rather than the legacy/composed `friendly_name` attribute. It does not evaluate
`card.name` or compose area/device/entity parts from the card configuration.

`limit` applies after selection, global exclusion, deduplication, and sorting, before visual grouping.
`limit: 0` returns an empty list. There are no per-include limits.

## Heading

A string is shorthand for a native Title-style heading:

```yaml
heading: Office
```

The full form accepts native heading options, without needing `type: heading`:

```yaml
heading:
  heading: Office
  heading_style: title
  icon: mdi:desk
  tap_action:
    action: navigate
    navigation_path: /dashboard-home/office
  badges:
    - type: entity
      entity: sensor.office_temperature
```

The main heading defaults to `heading_style: title`; you can select `subtitle` if
preferred. Text containing `{{` or `{%` is automatically rendered as backend Jinja,
in both the string shorthand and the `heading.heading` property. Explicit `$heading`
is also supported. Other properties opt in with `$`, including nested action and
badge options, following the same string-output rules as card-option templates:

```yaml
heading:
  heading: "Outdoor temperature: {{ states('sensor.outdoor_temperature') }} °C"
  $icon: >-
    {{ 'mdi:snowflake' if states('sensor.outdoor_temperature') | float(0) < 0
       else 'mdi:thermometer' }}
```

Static headings need no template subscription. A templated main heading uses one
shared subscription independently of selection, with `config` holding its static
options; it has no implicit `entity` or group variables. Use explicit entity IDs
with HA helpers. Badges receive live `hass` updates normally. An empty heading with
no icon or badges takes no space. Headings with templates use YAML in the editor.

Clearing a plain text heading removes it; icon-only and badge-only headings remain
supported. The heading configuration does not affect entity selection.

`group.heading` accepts the same string shorthand and native configuration as the
main heading, including `$icon`, actions, and badges. Its only default-style
difference is `heading_style: subtitle`. Group heading configuration is edited in
Selection YAML. A single group has no group heading. The old `group.title` option
has been removed; use `group.heading`.

## Grouping

Grouping adds section-style headings and a fresh grid for each group. It is disabled
by default. The top-level `include` field still selects entities; `group` controls
how the results are presented.

```yaml
type: custom:auto-grid
heading: Controls
include:
  - group: Lights
    domain: light
  - group: Problems
    type: binary_sensor/problem
group: true
```

| `group`                        | Meaning                                             |
| ------------------------------ | --------------------------------------------------- |
| Omitted / `false`              | One grid without group headings                     |
| `true` / `{}` / `group`        | Group by the winning include's group label or index |
| `area` (or another field)      | Group by that field's value                         |
| `{ by: area, heading: "..." }` | Group by a field with a custom heading template     |

```yaml
# Group lights by their resolved area name
type: custom:auto-grid
include:
  domain: light
group: area
```

Equal field values merge, even when they come from different include rules or
metadata entries. For example, different devices both named `TV` intentionally
share a device group. Two includes named `Lights` also merge. Types remain distinct:
numeric `0`, string `"0"`, and boolean `false` are separate values. Label grouping uses
the entire canonical label-name list; it does not duplicate entities into multiple
groups. Objects are compared by value, ignoring key order.

Sorting happens first, then the global limit, then grouping. Group order follows
first appearance in the sorted/limited results, and cards retain their relative order
within each group. The default name sort does **not** implicitly alphabetize group
headings. To order by the group field, use an explicit sort:

```yaml
group: area
sort:
  - area
  - name
```

For named include groups, use `group: true` and `sort: [group, name]`. Unnamed fallback
indexes sort numerically, followed by named groups alphabetically; `reverse` reverses
that order. `sort: group` works even when visual grouping is disabled.

### Heading templates

The default heading text is `{{ group_name }}`. All `group.heading` templates render
inside the existing backend query, not through a separate subscription per heading.
Heading text supports full Jinja and is displayed as text, never HTML.

Available variables:

- `group`: the literal grouping value.
- `group_name`: its default display value. Usually the same as `group`, but integration
  domains use manifest names (`mqtt` → `MQTT`). Domain/type headings split underscores
  into words and capitalize each word (`binary_sensor` → `Binary Sensor`). Entity types
  use the device class (`sensor/carbon_dioxide` → `Carbon Dioxide`) or the domain when
  no class exists. Missing values use an empty display value. Other fields keep their
  existing display values unchanged.
- `group_count`: the total number of resulting groups after filtering, sorting, and
  the global limit (not the number of entities in this particular group).
- `entity`: the first entity ID string in the group after sorting and limiting,
  with the same meaning as in card templates. Use `states(entity)`,
  `state_attr(entity, 'attribute')`, or `states[entity]` for state access, and
  `entity_name(entity, fallback=true)` for modern entity naming.
- `config`: the heading's static options, with `entity` injected. `$` properties
  are excluded, just as in card templates.

```yaml
group:
  by: area
  heading: "{{ group_name or 'Unassigned' }}"
```

```yaml
group:
  by: label
  heading: "{{ group | join(', ') or 'Unlabelled' }}"
```

Integration headings use friendly names when available, falling back to the raw
domain if the lookup fails. Custom templates can use `group` for the domain and
`group_name` for the friendly name.

Missing values form a group rather than dropping entities. An empty title omits its
heading but keeps a separate grid. Empty groups never render. If only one group
remains, its heading is automatically hidden, including custom headings; the grid
keeps its cards and reserves no header height. Titles are still evaluated, so a
second group appearing restores headings without a new subscription. The top-level
`heading` stays visible and `show_empty` retains its usual behavior for the whole card.

## Explicit card-option templates

Prefix a property name with `$` to have **Auto Grid** evaluate its value as Jinja.
The generated card receives the normal property name without `$`:

```yaml
card:
  type: custom:mushroom-template-card
  primary: "{{ entity_name(entity) }}" # Mushroom owns this template; untouched
  tap_action:
    action: url
    $url_path: >-
      {{ 'https://dockge.folke.io/compose/' ~
         (state_attr(entity, 'stack') | urlencode) }}
```

Only `$` keys opt in. Unprefixed strings, including Jinja intended for Mushroom or
another custom card, pass through unchanged. Nested objects and objects inside arrays
are supported. Each `$` value must be a string; rendered output is a string with outer
whitespace trimmed, not parsed as JSON, a number, a boolean, or an object. Mark scalar
fields such as `$url_path`, not an entire action object. A static value is also valid.

`url_path` and `$url_path` cannot appear in the same object. Empty `$` keys and doubled
prefixes such as `$$name` are rejected. Per-include overrides still merge shallowly,
but recognize `name` and `$name` as the same destination property.

Templates receive:

- `entity`: the selected entity ID string, matching Mushroom's convention.
- `config`: the effective static card configuration, with the selected `entity`
  injected. Ordinary strings/templates remain literal; `$` properties are excluded.
- `area`: the statically configured `config.area`, or `none` when absent/templated.
- `group`, `group_name`, `group_count`: the current visual group's values when grouping
  is enabled; otherwise `none`, an empty string, and `0`, respectively.

Templates do **not** depend on evaluation order: `$area` does not become `area` for a
sibling `$name`, nor do rendered values get injected into `config` for other templates.
Use entity attributes or static `config` values for shared inputs.

Values render **after selection, exclusions, sorting, and limiting**, for the winning
include only. Changing the rendered options updates the affected cards.

### Container update links

This example needs only native tiles; Auto Grid computes the different action URL
for each selected entity:

```yaml
type: custom:auto-grid
heading: Container Updates
columns: 2
include:
  type: update
  entity: "update.wud_*"
  state: "on"
  attr.stack: "/.+/"
  attr.watcher:
    - dockge
    - servarr
    - frigate
card:
  type: tile
  tap_action:
    action: url
    $url_path: >-
      {% set watcher = state_attr(entity, 'watcher') %}
      {% set base = 'https://servarr.folke.io'
         if watcher == 'servarr' else 'https://dockge.folke.io' %}
      {% set suffix = '/10.0.0.6:5001' if watcher == 'frigate' else '' %}
      {{ base }}/compose/{{ state_attr(entity, 'stack') | urlencode }}{{ suffix }}
  hold_action:
    action: more-info
  icon_tap_action:
    action: more-info
```

Template errors appear in the card with a Retry button. For details about query
context and subscriptions, see [Internals](internals.md#-card-option-templates).
