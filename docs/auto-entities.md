# 🔄 Coming from auto-entities

[← README](../README.md) · [Configuration reference](configuration.md)

[auto-entities](https://github.com/thomasloven/lovelace-auto-entities) populates another
card's `entities`, `cards`, or other configured property. **Auto Grid owns its layout
and creates one child card per selected entity.** It is a good fit for automatically
populated grids of tiles or custom entity cards, not a drop-in replacement for every
auto-entities configuration.

## Before and after

An auto-entities grid of Office lights:

```yaml
type: custom:auto-entities
card:
  type: grid
  columns: 2
  square: false
card_param: cards
show_empty: false
filter:
  include:
    - area: Office
      domain: light
      options:
        type: tile
  exclude:
    - state: unavailable
sort:
  method: name
```

With Auto Grid:

```yaml
type: custom:auto-grid
columns: 2
square: false
show_empty: false
include:
  area: Office
  domain: light
exclude:
  state: unavailable
card:
  type: tile
sort: name
```

The Auto Grid example spells out the layout, child card, empty behavior, and sorting
for comparison; all of those values are defaults. There is no outer `card: grid` or
`card_param`: `card` describes each child instead. For responsive wrapping, use
`columns: auto` (140px minimum) or a pixel minimum such as `columns: 180px`. Use
`columns: all` for a single row.

## Common configuration changes

These are translations to Auto Grid's canonical syntax, not a compatibility promise.

| auto-entities                            | Auto Grid                                                                        |
| ---------------------------------------- | -------------------------------------------------------------------------------- |
| `filter.include` / `filter.exclude`      | Top-level `include` / `exclude`                                                  |
| Per-include `options`                    | Per-include `card`; put shared options in the top-level `card`                   |
| `options.type: tile`                     | `card.type: tile`                                                                |
| Grid container's `columns` / `square`    | Top-level `columns` / `square`                                                   |
| `entity_id: "light.*"`                   | `entity: "light.*"`                                                              |
| `attributes: { battery: "< 20" }`        | `attr.battery: "< 20"`                                                           |
| `and` / `or`                             | `all` / `any`                                                                    |
| `sort: { method: state, numeric: true }` | `sort: { by: state, numeric: true }`                                             |
| Global `sort.count: 5`                   | Top-level `limit: 5`, after global sorting                                       |
| Explicit `entities: [light.a, light.b]`  | `include: { entity: [light.a, light.b] }`; use `sort: []` to preserve list order |

`domain`, `state`, `area`, `floor`, `device`, `label`, `integration`, and `not` have
familiar counterparts, but check the [filter reference](configuration.md#filter-rules)
for supported values. In particular, regexes run on the backend with Python syntax,
not JavaScript syntax, and not every field accepts wildcard/regex matching.

## Differences that matter

- **Selection is unique and first-match wins.** An entity produces one card, using
  the first matching include's overrides. Rules inside a filter are AND; include
  filters are OR. Global exclusions remove matches regardless of their include.
- **Sorting is global and defaults to name.** Use `sort: []` for unsorted candidate/
  include order. Name filtering and sorting use HA's modern entity naming with device
  fallback, not the legacy composed `friendly_name`. There is no per-include sort or
  limit. See [sorting and limits](configuration.md#sorting-and-limits).
- **Card overrides are shallow.** Nested objects and arrays replace inherited values,
  rather than merging recursively. The selected `entity` is supplied automatically;
  do not put it in the child `card` configuration.
- **`type` and `group` mean different things.** In an Auto Grid filter, `type` selects
  a domain or domain/device class, such as `sensor/battery`; child-card type belongs
  in `card.type`. `group` labels or visually groups results—it does not expand an HA
  group entity. Use [group headings](configuration.md#grouping) instead of inserted
  section rows.
- **Some rules have no direct equivalent.** Raw `filter.template` entity-list
  generation, translated-state matching, relative-time rules, nested attribute paths,
  and arbitrary row insertion are not supported. `last_changed` / `last_updated`
  comparisons use Unix timestamps in seconds, not elapsed minutes. `hidden: true`
  matches both user- and integration-hidden entities, not just one `hidden_by` value.
  `else` fallback cards and arbitrary `card_param` containers are not supported either.
- **Templates opt in per option.** Use `$name`, `$icon`, or nested `$url_path` for
  Auto Grid's backend Jinja, with `entity` as the entity ID string. Ordinary Mushroom
  templates pass through unchanged. Results are strings, not native objects or lists;
  this is not a replacement for `filter.template`. See
  [card-option templates](configuration.md#explicit-card-option-templates).
- **Empty grids hide by default.** Set `show_empty: true` to keep a placeholder.
  A hidden empty grid remains subscribed so it can populate when entities match.

## Why the implementation differs

Auto Grid compiles selection into HA backend templates instead of repeating entity
filtering in the browser on ordinary `hass` updates. Identical generated queries share
one subscription per connection. Child cards are retained by entity ID, and effective
option changes reconfigure them where possible rather than rebuilding the whole grid.
Ordinary `hass` updates only forward state to those retained cards.

That shifts work and can reduce browser-side overhead; it does **not** make backend
queries free or guarantee that every configuration is faster than auto-entities.
Prefer scoped area, label, integration, explicit-entity, or domain/type queries over
broad state scans. HA's template rate limits still apply. See
[Internals](internals.md) for subscription behavior and performance trade-offs.
