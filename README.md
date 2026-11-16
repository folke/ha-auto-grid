# Auto Grid

An automatically populated grid of Home Assistant cards. Native tiles by default,
shared YAML options, and entity selection evaluated by Home Assistant—not by the browser.

Auto Grid is a standalone card, not a section or an auto-entities-compatible wrapper.
It works in Sections and other dashboard views. Styling is independent: generated cards
can use [Lovelace Styler](https://github.com/folke/lovelace-styler), but do not require it.

## Installation

Build with `pnpm install && pnpm build`, then copy `dist/auto-grid.js` to your HA
`www` directory. Register it under **Settings → Dashboards → Resources** as a JavaScript
module. For example:

```yaml
url: /local/auto-grid.js
type: module
```

For the local deploy recipe below, use `/hacsfiles/ha-auto-grid/auto-grid.js` if HA/HACS
serves that directory, or `/local/community/ha-auto-grid/auto-grid.js` directly.

Refresh the browser after registering or updating the resource. Add a **Manual** card
and paste one of the configurations below. This first version is YAML-only.

## Pool lights

```yaml
type: custom:auto-grid
columns: 2
filter:
  area: pool
  domain: light
sort:
  by: name
options:
  type: tile
  name:
    type: entity
```

`options.type` defaults to `tile`. `columns` defaults to `2`, and `square` to `false`.
All matching entities receive their own independent copy of `options`, plus an
`entity` field supplied by the query. Custom entity-based cards work too:

```yaml
type: custom:auto-grid
filter:
  area: pool
  domain: light
options:
  type: custom:mushroom-light-card
  show_brightness_control: true
```

## Custom templates

Use `entities` instead of `filter` to supply your own backend Jinja template:

```yaml
type: custom:auto-grid
columns: 2
entities: >-
  {{ area_entities('pool')
     | select('match', '^light[.]')
     | select('is_state', 'on')
     | list }}
options:
  type: tile
  name:
    type: entity
```

The result must be a **native list of entity ID strings**. Don't return comma-separated
text, JSON text via `tojson`, or card configuration objects. HA's template subscription
parses native list results; Auto Grid validates them and removes duplicate IDs while
preserving order. Shared options stay in YAML.

Apply sorting and limits inside custom templates. The top-level `sort` and `limit`
options apply to structured filters and static lists, not custom templates.

A static list also works, without any backend subscription:

```yaml
type: custom:auto-grid
entities:
  - light.pool
  - light.hall
options:
  type: tile
```

## Structured filters

All keys in a filter must match (**AND**). Lists of values for one key match any
value (**OR**). Structured filters are compiled to Jinja and subscribed through
HA's `render_template` WebSocket API.

| Rule         | Value                                                           |
| ------------ | --------------------------------------------------------------- |
| `area`       | Area ID/name, or a list                                         |
| `floor`      | Floor ID/name, or a list                                        |
| `device`     | Device ID, or a list                                            |
| `label`      | Label ID/name, or a list                                        |
| `domain`     | Exact domain name, or a list, e.g. `light`                      |
| `entity_id`  | Exact ID, wildcard, `/regex/`, or a list                        |
| `state`      | Exact value, wildcard, `/regex/`, numeric comparison, or a list |
| `name`       | State object's friendly name, with the same matching syntax     |
| `attributes` | Map of attribute names to matching values                       |
| `all`        | List of filters, all must match                                 |
| `any`        | List of filters, at least one must match                        |
| `not`        | A filter that must not match                                    |

Area/floor/device/label membership uses HA's corresponding `*_entities()` helper
semantics. An area includes entities assigned through a device. Nested attribute
paths, translated-state matching, relative-time rules, per-rule options, and
per-rule pagination are not implemented in this version. Unknown filter rules are
rejected, not silently ignored.

Strings match exactly unless they contain `*` or are delimited with `/` for a Python
regular expression. Globs are anchored, `*` matches any sequence, and other characters
are literal. Matching is case-sensitive. Numeric comparison strings support
`<`, `<=`, `>`, `>=`, `=`, `==`, and `!=`; non-numeric entity values do not match these.
Numeric YAML values compare numerically; booleans and `null` are useful for attributes.
Attribute names are literal top-level keys, including any dots or colons.

```yaml
type: custom:auto-grid
show_empty: false
filter:
  area: pool
  any:
    - domain: light
      state: "on"
    - domain: binary_sensor
      attributes:
        device_class: problem
      state: "on"
  not:
    entity_id: "*_diagnostic"
sort:
  by: name
options:
  type: tile
```

Quote `"on"` and `"off"` in YAML. For low batteries:

```yaml
type: custom:auto-grid
filter:
  label: batteries
  domain: sensor
  attributes:
    device_class: battery
  state: "< 20"
sort:
  by: state
  numeric: true
limit: 8
options:
  type: tile
```

### Sorting and limits

```yaml
sort:
  by: name
  reverse: false
limit: 10
```

Supported `by` values: `entity_id`, `name`, `state`, `last_changed`, `last_updated`,
and `attribute` (requires `attribute: battery`, for example). Add `numeric: true`
for numeric state/attribute sorting. Timestamp sorts are numeric automatically.
String sorts are case-insensitive. Missing/non-numeric values in numeric sorts go
last in either direction. Without a sort, candidate order is retained. `limit` is
applied after filtering, sorting, and deduplication; `0` returns an empty list.

`name` means the HA state object's name, not a card's `options.name` or necessarily
the contextual device/area name rendered by a modern tile.

## Options

| Option       | Default          | Description                                                                    |
| ------------ | ---------------- | ------------------------------------------------------------------------------ |
| `entities`   | —                | Static entity list or backend Jinja template; mutually exclusive with `filter` |
| `filter`     | —                | Structured backend query; mutually exclusive with `entities`                   |
| `options`    | `{ type: tile }` | Shared child-card configuration; `entity` is reserved                          |
| `columns`    | `2`              | Positive integer; fixed equal-width columns                                    |
| `square`     | `false`          | Square cells, like the native grid card                                        |
| `show_empty` | `false`          | Show an empty-state message; `false` hides the grid when empty                 |
| `sort`       | —                | Backend sorting for structured filters/static lists                            |
| `limit`      | —                | Maximum number of results for structured filters/static lists                  |

This is an equal-column grid, not the full Sections layout engine. It does not
implement per-card column/row spans. Grid spacing can be customized with the
`--auto-grid-gap` CSS property; otherwise it uses HA's `--grid-card-gap` or `8px`.

## Performance and lifecycle

- A backend query returns only ordered entity IDs. Card options are not sent to the backend.
- Identical template strings share one subscription per HA connection in this plugin.
- Ordinary `hass` updates only forward state to existing child cards. They do not run
  filters, call child `setConfig()`, or re-render the grid.
- Membership/order changes reuse cards by entity ID; removed cards are released.
  Editing shared options recreates the affected set of cards, but doesn't reopen the query.
- Stale async card creation cannot overwrite newer results or mount after disconnection.
- Disconnecting releases the subscription; reconnecting obtains fresh results and
  reuses retained cards. The last active consumer closes a shared subscription.
- Native HA conditional visibility disconnects cards by default, which releases the
  subscription. Other wrappers that only apply CSS hiding may keep it connected and
  subscribed. This version has no general active-view visibility observer.
- Below-the-fold cards and background browser tabs remain subscribed while connected.
- An empty grid remains subscribed so it can populate again. It remains visible in
  HA's editor preview even with `show_empty: false`.
- Template errors and helper failures are shown in the card, with a Retry button.

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
It is not a guarantee of immediate metadata invalidation. Time-based custom templates
also follow HA's template scheduling rules.

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

- `just` / `just build`: build and copy to `root@10.0.0.4:/config/www/community/ha-auto-grid/`.
- `just check`: typecheck, lint, format check, and unit tests.
- `just watch`: rebuild locally on changes (does not deploy).

The deploy recipe removes a stale `.gz` sibling, as Styler's recipe does. It never
changes your dashboard or resource registration. Register the resource once, then
hard-refresh the browser after deploying updates.
