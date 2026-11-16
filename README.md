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
Results are sorted by include group, then alphabetically by name by default.

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
independent copy. The `entity` field is reserved and cannot be configured in `card`.

`exclude` accepts a filter or list of filters. Matching **any** exclusion removes the
entity globally, regardless of which include group selected it. A `not` rule inside
an include group excludes only from that group; a later group can still select it.
Exclusions and nested filters cannot contain card configuration.

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
    domain: binary_sensor
    device_class: problem
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

## Filter rules

Lists of values for a single rule match any value (**OR**). Filters are compiled to
one Jinja query and subscribed through HA's `render_template` WebSocket API.

| Rule           | Value                                                                |
| -------------- | -------------------------------------------------------------------- |
| `area`         | Area ID/name, or a list                                              |
| `floor`        | Floor ID/name, or a list                                             |
| `device`       | Device ID, or a list                                                 |
| `label`        | Label ID/name, or a list                                             |
| `domain`       | Exact domain name, or a list, e.g. `light`                           |
| `entity_id`    | Exact ID, wildcard, `/regex/`, or a list                             |
| `device_class` | Shorthand for matching `attributes.device_class`; string or list     |
| `hidden`       | Boolean; whether HA's entity registry marks the entity as hidden     |
| `state`        | Exact value, wildcard, `/regex/`, numeric comparison, or a list      |
| `name`         | Entity's own name, with device fallback and the same matching syntax |
| `attributes`   | Map of attribute names to matching values                            |
| `all`          | List of filters, all must match                                      |
| `any`          | List of filters, at least one must match                             |
| `not`          | A filter that must not match                                         |

Area/floor/device/label membership uses HA's corresponding `*_entities()` helper
semantics. An area includes entities assigned through a device. `device_class` and
an explicit `attributes.device_class` are additional AND constraints: contradictory
values match nothing; neither overrides the other.

`hidden: true` matches entities hidden by either the user or an integration.
`hidden: false` matches entities that are not hidden, including entities without a
registry entry. Omit the rule to ignore hidden status (the default). It compiles to
HA's `is_hidden_entity()` helper, not a state attribute or dashboard visibility check.
Like other registry metadata, immediate reevaluation after registry-only edits depends
on HA's template tracking.

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
Attribute names are literal top-level keys, including any dots or colons.

Quote `"on"` and `"off"` in YAML. For low batteries:

```yaml
type: custom:auto-grid
include:
  label: batteries
  domain: sensor
  device_class: battery
  state: "< 20"
sort:
  by: state
  numeric: true
limit: 8
```

Raw user templates, nested attribute paths, translated-state matching, relative-time
rules, and per-group sorting/pagination are not implemented. Unknown filter rules
are rejected. The earlier `filter`, `entities`, and `options` fields have been replaced
by `include`/`exclude` and `card`; old configurations produce a migration error.

## Sorting and limits

The default is:

```yaml
sort:
  - by: include
  - by: name
```

An explicit `sort` **replaces** the default. A single sort object is shorthand for a
one-element list. Lists are in priority order: the first entry is the primary key,
with subsequent entries breaking ties.

```yaml
# Alphabetical across all groups, without include grouping
sort:
  by: name
```

```yaml
# Include grouping, then descending numeric state within each group
sort:
  - by: include
  - by: state
    numeric: true
    reverse: true
```

Supported `by` values: `include` (winning include group's index), `entity_id`, `name`,
`state`, `last_changed`, `last_updated`, and `attribute` (requires `attribute: battery`,
for example). Each sort has independent `numeric` and `reverse` flags. Include and
timestamp sorts are numeric automatically. String sorts are case-insensitive.
Missing/non-numeric values in numeric sorts go last in either direction.

Whenever sorting is enabled, entity ID is the final ascending tie-breaker for
predictable ordering. **`sort: []` disables all sorting**, including that fallback,
and retains include-group order followed by candidate order within each group.

Both the `name` filter and `sort.by: name` use HA's
`entity_name(entity, fallback=true)`: the entity's own registry name, falling back to
its device name when it has no own name and delegates naming to that device. Entities
without registry entries use the state object's name. This follows HA's modern naming
model rather than the legacy/composed `friendly_name` attribute. It does not evaluate
`card.name` or compose area/device/entity parts from the card configuration.

`limit` applies last, after selection, global exclusion, deduplication, and sorting.
`limit: 0` returns an empty list. There are no per-include limits.

## Options

| Option       | Default            | Description                                                 |
| ------------ | ------------------ | ----------------------------------------------------------- |
| `include`    | Required           | A selection filter or list; groups may override `card`      |
| `exclude`    | —                  | A global exclusion filter or list                           |
| `card`       | `{ type: tile }`   | Shared child-card configuration; `entity` is reserved       |
| `columns`    | `2`                | Positive integer; fixed equal-width columns                 |
| `square`     | `false`            | Square cells, like the native grid card                     |
| `show_empty` | `false`            | Show an empty-state message instead of hiding the grid      |
| `sort`       | Include, then name | Sort object or priority-ordered list; `[]` disables sorting |
| `limit`      | —                  | Maximum number of results, applied last                     |

This is an equal-column grid, not the full Sections layout engine. It does not
implement per-card column/row spans. Grid spacing can be customized with the
`--auto-grid-gap` CSS property; otherwise it uses HA's `--grid-card-gap` or `8px`.

## Performance and lifecycle

- One backend query returns ordered entity IDs and their winning include-group indexes.
  Card configuration is never sent to the backend.
- Identical generated queries share one subscription per HA connection, even when
  their frontend card configurations differ.
- Ordinary `hass` updates only forward state to existing child cards. They do not run
  filters, call child `setConfig()`, or re-render the grid.
- Membership/order changes reuse cards by entity ID and effective configuration.
  A winning-group change only replaces a card if its effective configuration changes.
- Editing card configuration only recreates affected children, without reopening the
  query. Removed cards are released.
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

The compiler narrows candidates to an area/device/label/floor, explicit IDs, or domains
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
