# 🧩 Auto Grid

Automatic entity grids for Home Assistant.

**Auto Grid** selects entities and turns them into native tiles or your favorite
custom cards. Keep shared card options in YAML, let Home Assistant handle selection,
and stop maintaining lists of entities by hand.

## ✨ Features

- **Automatic selection** — filter by area, label, device, entity type, state,
  attributes, and more. Combine include rules with global exclusions.
- **Backend filtering** — Home Assistant evaluates selection instead of repeating
  filter work in the browser on every state update.
- **Your cards, your options** — native tiles by default, custom entity cards when
  you want them. Share settings globally and override them per include rule.
- **Groups and headings** — organize cards by area, device, type, or another field,
  with native heading cards and optional Jinja titles.
- **Explicit templates** — opt individual card options into Jinja with `$` keys,
  without interfering with templates owned by Mushroom or other cards.
- **Native visual editing** — configure the grid, heading, and child card with
  familiar Home Assistant controls; edit selection rules as YAML.
- **Updates without rebuilding everything** — unchanged cards are retained as
  results change. Empty grids hide and reappear when entities match again.

## 📋 Requirements

- Home Assistant with dashboard custom-card support and backend templating.
- Any custom cards referenced by your configuration must be installed separately.

No companion integration is required. Auto Grid works in Sections and other views.
It is a standalone card, not a section or a drop-in auto-entities wrapper.
[Lovelace Styler](https://github.com/folke/lovelace-styler) is supported but optional.

## 📦 Installation

[![Open your Home Assistant instance and open a repository in the Marketplace.](https://my.home-assistant.io/badges/marketplace_repository.svg)](https://my.home-assistant.io/redirect/marketplace_repository/?owner=folke&repository=ha-auto-grid&category=plugin)

### Marketplace / HACS

Use the badge above to add this repository as a **Dashboard** plugin and install it.
On older Home Assistant versions, add `https://github.com/folke/ha-auto-grid` as a
custom Dashboard repository in HACS. The repository does not need to be in the
central catalog to install it this way.

The Marketplace downloads `auto-grid.js` from the GitHub release and normally
registers the dashboard resource automatically. For YAML-managed resources, follow
the resource instructions shown during installation.

### Manual installation

1. Download **`auto-grid.js`** from the [latest release](https://github.com/folke/ha-auto-grid/releases/latest).
   Use the attached JavaScript asset, not GitHub's source ZIP.
2. Copy it to `<config>/www/auto-grid.js`.
3. Add `/local/auto-grid.js?v=0.1.0` as a dashboard resource with type **JavaScript
   module**. Change the version query when updating to avoid stale browser caches.

Refresh the browser after installing or updating. Add a **Manual** card and paste
the quick-start configuration below. A focused visual editor is available for layout
and the shared `card:` configuration; selection rules remain YAML-based.

## ⚡ Quick Start

Select the lights in an area and give every tile the same configuration:

```yaml
type: custom:auto-grid
heading: Pool lights
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
An optional `heading` uses HA's native heading card with Title style by default.
It hides together with the grid when empty and `show_empty` is false.

## ⚙️ Configuration

Use `include` to select entities and `card` for shared child-card options. Rules in
one filter are **AND**; a list of include filters is **OR**. The first matching
include wins, each entity appears once, and `exclude` removes matches globally.

| Option       | Default          | Description                                                               |
| ------------ | ---------------- | ------------------------------------------------------------------------- |
| `include`    | Required         | A selection filter or list; groups may override `card`                    |
| `exclude`    | —                | A global exclusion filter or list                                         |
| `card`       | `{ type: tile }` | Shared child-card configuration; `entity` is reserved                     |
| `heading`    | —                | Native heading config or text shorthand; defaults to Title style          |
| `title`      | —                | Compatibility text alias for `heading`; cannot be combined with it        |
| `columns`    | `2`              | Positive integer for fixed columns, or `auto` for a single horizontal row |
| `square`     | `false`          | Square cells, like the native grid card                                   |
| `show_empty` | `false`          | Show loading/empty placeholders instead of hiding the grid                |
| `group`      | `false`          | Boolean, field name, or `{ by, title }` for visual grouping               |
| `sort`       | `name`           | Sort string/object or mixed priority-ordered list; `[]` disables sorting  |
| `limit`      | —                | Maximum results after sorting, before grouping                            |

For the complete reference, see [Configuration](docs/configuration.md):

- [Selection and overrides](docs/configuration.md#include-groups-and-global-exclusions)
- [Filter rules](docs/configuration.md#filter-rules)
- [Sorting and limits](docs/configuration.md#sorting-and-limits)
- [Heading](docs/configuration.md#heading) and [grouping](docs/configuration.md#grouping)
- [Grid and stack layouts](docs/configuration.md#grid-and-stack-layouts)
- [Card-option templates](docs/configuration.md#explicit-card-option-templates)

### Visual Editor

The editor has four collapsible panels:

| Panel         | What it edits                                                    |
| ------------- | ---------------------------------------------------------------- |
| **Grid**      | Columns, square cells, and whether to show an empty grid         |
| **Heading**   | HA's native heading editor, including icons, actions, and badges |
| **Selection** | YAML for `include`, `exclude`, `group`, `sort`, and `limit`      |
| **Card**      | The shared child card, using its native editor or card-only YAML |

The native card's entity picker chooses a **preview sample**, not a saved entity or
selection rule. Use HA's outer code editor for other root options such as visibility
or Styler settings. Invalid drafts leave the last valid configuration intact.

Cards with `$` properties use card-only YAML to preserve templates. Unsupported
visual editors fall back to YAML. No additional editor resource is needed.

## 📚 Examples

### Custom Cards

```yaml
type: custom:auto-grid
include:
  area: pool
  domain: light
card:
  type: custom:mushroom-light-card
  show_brightness_control: true
```

### Group by Area

```yaml
type: custom:auto-grid
include:
  domain: light
group: area
sort:
  - area
  - name
```

Each area gets its own grid. A single remaining group's heading is hidden
automatically; the main `heading`, when configured, stays visible.

### Low Batteries

```yaml
type: custom:auto-grid
heading: Low batteries
include:
  type: sensor/battery
  state: "< 20"
sort:
  by: state
  numeric: true
limit: 8
```

### Include Overrides

```yaml
type: custom:auto-grid
card:
  type: tile
include:
  - area: pool
    domain: light
    card:
      features:
        - type: light-brightness
  - area: pool
    type: binary_sensor/problem
exclude:
  - state: unavailable
```

Nested options replace inherited values rather than merging recursively.
`card.entity` is reserved: Auto Grid supplies the selected entity.

## 💡 Notes

- `columns: auto` means one horizontal row, **not** responsive wrapping. Use a
  scoped selection or `limit` to avoid crowded rows.
- Use an area, label, integration, explicit entity list, or domain/type to scope
  queries. Broad queries can be rate-limited by Home Assistant.
- `show_empty: false` hides loading/empty grids, including their Sections layout
  gaps. An empty grid stays subscribed so it can populate again; query errors show
  a Retry button.
- This is an equal-column grid, not the full Sections layout engine. Per-card spans
  and minimum-width-based wrapping are not supported.

For architecture, subscription behavior, and performance trade-offs, see
[Internals](docs/internals.md). Maintainer release instructions are in
[Releases](docs/releases.md); user-facing changes are in [CHANGELOG.md](CHANGELOG.md).

## 🤝 Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for setup,
tests, and local deployment.

## 📄 License

[MIT](LICENSE) © Folke Lemaitre
