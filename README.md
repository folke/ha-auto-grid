# Auto Grid

An automatically populated grid of Home Assistant cards. Native tiles by default,
shared YAML card configuration, and entity selection evaluated by Home Assistant—not
by the browser.

Auto Grid is a standalone card, not a section or an auto-entities-compatible wrapper.
It works in Sections and other dashboard views. Generated cards can use
[Lovelace Styler](https://github.com/folke/lovelace-styler), but do not require it.

## Installation

Build with `pnpm install && pnpm build`, then copy `dist/auto-grid.js` to your HA
`www` directory. Register it under **Settings → Dashboards → Resources** as a JavaScript
module. For example:

```yaml
url: /local/auto-grid.js
type: module
```

For the local deploy recipe below, use `/local/community/ha-auto-grid/auto-grid.js`.
Refresh the browser after registering or updating the resource. Add a **Manual** card
and paste one of the configurations below. Configuration is currently YAML-only.

## Pool lights

```yaml
type: custom:auto-grid
title: Pool lights
columns: 2
include:
  area: pool
  domain: light
card:
  type: tile
  name:
    type: entity
```

`card.type` defaults to `tile`, `columns` to `2`, and `square` to `false`.
Results are sorted alphabetically by name by default, regardless of include rules.
An optional `title` appears above the grid with native grid-card header styling.
It hides together with the grid when empty and `show_empty` is false.

Custom entity-based cards work too:

```yaml
type: custom:auto-grid
include:
  area: pool
  domain: light
card:
  type: custom:mushroom-light-card
  show_brightness_control: true
```

## Include groups and global exclusions

`include` is required and accepts one filter or a list of filters. Rules within a
filter are **AND**; include groups are **OR**. Each entity produces only one card:
**the first matching include group wins**.

An include group may override the global `card`. The merge is shallow:
`{ type: "tile", ...globalCard, ...groupCard, entity }`. Nested objects and arrays
replace inherited values; they are not recursively merged. Each child gets an
independent copy. The `entity` field is reserved and cannot be configured in `card`,
including as `$entity`. For templated options, overrides use the destination key:
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
  - entity_id: "*_diagnostic"
  - state: unavailable
```

For explicit entities, use `entity_id`. These still go through the backend query,
so the same sorting, exclusions, and include-group semantics apply:

```yaml
type: custom:auto-grid
include:
  entity_id:
    - light.pool
    - light.hall
sort: []
```

`sort: []` preserves the supplied order. `include: []` selects nothing; `include: {}`
selects every entity with a state. Be mindful of HA's rate limits for broad queries.

### JSON entity lists

`entity_id` also accepts a string containing a JSON array of non-empty strings:

```yaml
include:
  entity_id: '["sensor.b", "sensor.a"]'
sort: []
```

This is equivalent to a normal YAML list. Literal entity IDs become direct candidates
(no full-state scan), duplicates are removed, and `sort: []` preserves list order.
Glob/regex entries still use normal matching. Empty lists (`entity_id: []` or `"[]"`)
select nothing; excluding an empty list removes nothing, and negating it matches all
otherwise eligible entities.

Only `entity_id` parses JSON this way. Strings starting with `[` after whitespace
must be valid JSON arrays; malformed JSON and non-string/empty entries produce a
configuration error. Python-style `['sensor.foo']` is not JSON—use `| to_json`.
Other fields and `$` template output types are unchanged.

This lets an outer Auto Grid supply a generated selection to an inner grid without
turning arbitrary card templates into native lists:

```yaml
type: custom:auto-grid
columns: 1
include:
  entity_id: "pyscript.alert_*"
card:
  type: custom:auto-grid
  columns: 2
  sort: []
  include:
    # First, the alert itself
    - $entity_id: "{{ entity }}"
      card:
        type: tile
    # Then the related IDs, in their original order
    - $entity_id: >-
        {{ state_attr(entity, 'entities') | default([], true) | to_json }}
      card:
        type: custom:mushroom-entity-card
```

The outer grid resolves both `$entity_id` values in the parent entity's context. The
inner grid parses the resulting JSON string normally. Missing/empty `entities` leaves
just the alert header. Each nested grid owns its own query subscription; literal
child lists keep those queries scoped, and disconnecting the parent cleans them up.

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

Values render in the existing backend query **after selection, exclusions, sorting,
and limiting**, for the winning include only. There are no per-card/per-field Auto Grid
subscriptions. Cards with unchanged effective options are left alone; changed options
call that child's `setConfig()` when available. Changing `type` replaces the element.

### Container update links

This example needs only native tiles; Auto Grid computes the different action URL
for each selected entity:

```yaml
type: custom:auto-grid
title: Container Updates
columns: 2
include:
  type: update
  entity_id: "update.wud_*"
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

Static card configuration stays in the frontend. When opting into `$` templates, the
static configuration for those includes is embedded in the backend query to provide
`config`; only the rendered values are sent back alongside entity IDs. Editing that
context or the templates may therefore reopen the query. Syntax/runtime template
errors use the card's normal error display and Retry flow.

## Grouping

Grouping adds section-style headings and a fresh grid for each group. It is disabled
by default. The top-level `include` field still selects entities; `group` controls
how the results are presented.

```yaml
type: custom:auto-grid
title: Controls
include:
  - group: Lights
    domain: light
  - group: Problems
    type: binary_sensor/problem
group: true
```

| `group`                      | Meaning                                             |
| ---------------------------- | --------------------------------------------------- |
| Omitted / `false`            | One grid without group headings                     |
| `true` / `{}` / `group`      | Group by the winning include's group label or index |
| `area` (or another field)    | Group by that field's value                         |
| `{ by: area, title: "..." }` | Group by a field with a custom heading template     |

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

The default heading template is `{{ group_name }}`. A custom `group.title` is rendered
inside the existing backend query, not through a separate subscription per heading.
It supports full Jinja, and the output is displayed as text, never HTML.

Available variables:

- `group`: the literal grouping value.
- `group_name`: its default display value. Usually the same as `group`, but integration
  domains use manifest names (`mqtt` → `MQTT`) and entity types use their device class
  (`sensor/battery` → `battery`) or domain when no class exists. Missing values use an
  empty display value.
- `group_count`: the total number of resulting groups after filtering, sorting, and
  the global limit (not the number of entities in this particular group).
- `entity_id`: the first entity in the group after sorting and limiting.
- `entity`: that entity's state object; use `entity_name(entity_id, fallback=true)` for
  modern entity naming rather than its legacy `.name` property.

```yaml
group:
  by: area
  title: "{{ group_name or 'Unassigned' }}"
```

```yaml
group:
  by: label
  title: "{{ group | join(', ') or 'Unlabelled' }}"
```

Integration display names are fetched once per HA connection with `manifest/list`
and cached. The names are passed as variables to the same template subscription.
Lookup failures fall back to the raw domain and do not prevent the grid from loading.
Custom templates can use `group` for the domain and `group_name` for the friendly name.

Missing values form a group rather than dropping entities. An empty title omits its
heading but keeps a separate grid. Empty groups never render. If only one group
remains, its heading is automatically hidden, including custom headings; the grid
keeps its cards and reserves no header height. Titles are still evaluated, so a
second group appearing restores headings without a new subscription. The top-level
`title` stays visible and `show_empty` retains its usual behavior for the whole card.

## Filter rules

Lists of values for a single rule match any value (**OR**). Filters are compiled to
one Jinja query and subscribed through HA's `render_template` WebSocket API.

| Rule           | Value                                                                |
| -------------- | -------------------------------------------------------------------- |
| `area`         | Area ID/name, or a list                                              |
| `floor`        | Floor ID/name, or a list                                             |
| `device`       | Device ID or effective name; exact, wildcard, `/regex/`, or a list   |
| `label`        | Label ID/name, or a list                                             |
| `domain`       | Exact domain name, or a list, e.g. `light`                           |
| `entity_id`    | Exact ID, wildcard, `/regex/`, native list, or JSON-array string     |
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

Device rules do not narrow candidates with `device_entities()`: an exact-looking ID
can also be another device's name. Scoping by integration, area, explicit entity IDs,
or domain/type still narrows selection safely. A device-only query scans all states
and may therefore be subject to HA's broad-template rate limit. Device sorting and
grouping continue to use the effective display name.

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
- Type headings use the device class (`battery`) or the domain (`sensor`), without
  translating identifiers. `sensor/battery` and `binary_sensor/battery` remain
  separate groups even though both headings read `battery`.

`domain` remains available for domain-only grouping/filtering. For device-class
matching across domains, use `attr.device_class: battery`. The old `device_class`
shorthand has been removed; use `type: sensor/battery` or `attr.device_class` instead.
All rules still combine with AND, so contradictory type/domain/attribute constraints
match nothing.

`hidden: true` matches entities hidden by either the user or an integration.
`hidden: false` matches entities that are not hidden, including entities without a
registry entry. Omit the rule to ignore hidden status (the default). It compiles to
HA's `is_hidden_entity()` helper, not a state attribute or dashboard visibility check.
Like other registry metadata, immediate reevaluation after registry-only edits depends
on HA's template tracking.

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
`entity_id`, `type`, `hidden`, `state`, `name`, `last_changed`, `last_updated`,
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

## Options

| Option       | Default          | Description                                                               |
| ------------ | ---------------- | ------------------------------------------------------------------------- |
| `include`    | Required         | A selection filter or list; groups may override `card`                    |
| `exclude`    | —                | A global exclusion filter or list                                         |
| `card`       | `{ type: tile }` | Shared child-card configuration; `entity` is reserved                     |
| `title`      | —                | Optional text heading above the grid                                      |
| `columns`    | `2`              | Positive integer for fixed columns, or `auto` for a single horizontal row |
| `square`     | `false`          | Square cells, like the native grid card                                   |
| `show_empty` | `false`          | Show an empty-state message instead of hiding the grid                    |
| `group`      | `false`          | Boolean, field name, or `{ by, title }` for visual grouping               |
| `sort`       | `name`           | Sort string/object or mixed priority-ordered list; `[]` disables sorting  |
| `limit`      | —                | Maximum number of results, applied last                                   |

### Grid and stack layouts

- `columns: 1`: a vertical stack.
- `columns: 2` (the default): a two-column grid, wrapping into additional rows.
- `columns: auto`: one equal-width column per rendered card, like a horizontal stack.

```yaml
type: custom:auto-grid
columns: auto
include:
  area: office
  type: light
```

`auto` does **not** mean responsive wrapping or auto-fill: cards share a single row,
even on narrow screens. Each visual group calculates its own column count after
filtering and limiting. Membership changes update that count; changing between auto
and fixed columns preserves child cards and the backend subscription. Use a scoped
selection or `limit` to avoid an overly crowded horizontal row. `square` still applies.

This is an equal-column grid, not the full Sections layout engine. It does not
implement per-card column/row spans or minimum-width-based wrapping. Grid spacing can
be customized with the `--auto-grid-gap` CSS property; otherwise it uses HA's
`--grid-card-gap` or `8px`.

## Performance and lifecycle

- One backend query returns entity IDs and winning include-rule indexes, optionally
  with rendered `$` values and organized into typed groups with rendered titles.
  Static configuration remains frontend-only unless opted into template `config`
  context. There are no per-heading or per-option template subscriptions.
- Identical generated queries share one subscription per HA connection, even when
  their frontend card configurations differ.
- Ordinary `hass` updates only forward state to existing child cards. They do not run
  filters, call child `setConfig()`, or re-render the grid.
- Membership/order changes, including moves between visual groups, reuse cards by
  entity ID and effective configuration.
  A winning-group change does not reconfigure a card with identical effective options.
- Configuration changes update affected cards in place via `setConfig()`, replacing
  them only when their type changes or they cannot be reconfigured. Removed cards
  are released. Static card-only edits do not reopen the query; `$` templates and
  their static `config` context participate in the query.
- Stale async card creation cannot overwrite newer results or mount after disconnection.
- Disconnecting releases the subscription; reconnecting obtains fresh results and
  reuses retained cards. The last active consumer closes a shared subscription.
- Native HA conditional visibility disconnects cards by default, releasing the
  subscription. Wrappers that only apply CSS hiding may keep it connected and
  subscribed. There is no general active-view visibility observer yet.
- Below-the-fold cards and background browser tabs remain subscribed while connected.
- An empty grid remains subscribed so it can populate again. It remains visible in
  HA's editor preview even with `show_empty: false`.
- Query errors and helper failures are shown in the card, with a Retry button.

### Backend trade-offs

The compiler narrows candidates to an area/label/floor/integration, explicit IDs, or domains/types
where it can do so safely. Membership helpers are evaluated once per template render,
not once per entity. OR/NOT-only queries may require a full state scan.

HA can rate-limit templates that iterate all states (typically once per minute), or
all entities of a domain (typically once per second). A scoped candidate list avoids
those broad iteration patterns, though it still reads the states needed for filtering
and sorting. Backend work is reduced in scope, not eliminated.

Registry-only changes (renaming/reassigning areas, labels, devices) depend on HA's
tracking of the template helpers involved. This version does not separately subscribe
to registry events; if membership appears stale after such an edit, reload the card/view.
It is not a guarantee of immediate metadata invalidation.

## Development

Uses the same TypeScript, Vite, pnpm, oxlint, and oxfmt tooling as Lovelace Styler.
Lit is bundled; there are no CDN imports or required companion integrations.

```sh
pnpm install
pnpm check
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm test:browser
```

Node 22.18+ is required for native TypeScript test imports. `pnpm test` exercises
configuration/compiler behavior, subscription sharing/cleanup, races, and keyed card
reuse. If Python 3 with Jinja2 is available, it also executes generated queries in a
sandbox with mocked HA helpers; otherwise that optional check is skipped.

`pnpm test:browser` requires Chromium (`CHROME_BIN` can override the executable).
It builds the bundle and tests rendering, identity-preserving reordering, zero DOM
mutations on state updates, empty-state recovery, preview, errors, and teardown in a
real headless browser. The card helpers and backend are mocked: live HA compatibility
still needs testing on your installation.

### Local deployment

The git-ignored `justfile` mirrors Styler's local workflow:

- `just` / `just build`: validate, build, and copy to `root@10.0.0.4:/config/www/community/ha-auto-grid/`.
- `just check`: typecheck, lint, format check, and unit tests.
- `just watch`: rebuild locally on changes (does not deploy).

The deploy recipe removes a stale `.gz` sibling, as Styler's recipe does. It never
changes your dashboard or resource registration. Register the resource once, then
hard-refresh the browser after deploying updates.
