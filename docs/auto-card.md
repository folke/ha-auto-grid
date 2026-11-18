# 🪄 Auto Card

[← README](../README.md) · [Auto Grid configuration](configuration.md)

**Add reactive backend Jinja to the configuration of an existing Home Assistant
card—even if that card has no template support of its own.** Use `custom:auto-card`
for one card, or `custom:auto-grid` to select entities and generate multiple cards.
Both are included in the same `auto-grid.js` resource; no extra installation is needed.

## Example

```yaml
type: custom:auto-card
heading: Pool controls
card:
  type: tile
  entity: light.pool
  $name: >-
    {{ 'Pool lights are on' if is_state(entity, 'on')
       else 'Pool lights are off' }}
  $icon: >-
    {{ 'mdi:lightbulb-on' if is_state(entity, 'on')
       else 'mdi:lightbulb-outline' }}
```

There is no entity selection or grid container. `card` is the actual inner-card
configuration, and `heading` is optional. `card.type` is required; static `entity`
and templated `$entity` are both allowed, unlike Auto Grid where selection supplies
that property.

Cards without an entity work too:

```yaml
type: custom:auto-card
card:
  type: picture
  $image: "{{ state_attr('camera.front_door', 'entity_picture') }}"
  tap_action:
    action: navigate
    navigation_path: /dashboard-home/cameras
```

## Templates and context

A `$` prefix opts a property into Auto Card's backend Jinja rendering. The child
receives the ordinary property name, without `$`. Nested object properties and
properties inside arrays work too. Unprefixed strings are passed through unchanged,
including templates intended for Mushroom or another child card.

Templates receive:

- `config`: the inner card's original static options, excluding `$` properties.
- `entity`: shorthand for the static `config.entity`, or `none` when absent.

There are no `area` or `device` shorthands. Use `area_name(entity)`, `area_id(entity)`,
`device_id(entity)`, or explicit static `config` fields when needed. Templates can
reference any entity through HA helpers; the card does not need an `entity` option.

Each template is independent. A rendered `$entity` does not become `entity` or
`config.entity` for sibling templates, and rendered options are never fed back into
`config`. Define shared inputs as static card options or use HA helpers directly.

**Results are strings with outer whitespace trimmed.** They are not parsed as JSON,
numbers, booleans, lists, or objects. Mark string-valued leaves such as `$url_path`,
not an entire action object. `name` and `$name` cannot coexist in the same object.
The child card must still accept the resulting configuration; Auto Card does not
add template support inside a card's own implementation or change its option types.

## Heading and layout

`heading` uses the same [native heading configuration](configuration.md#heading) as
Auto Grid, with Title style by default. Ordinary heading strings are literal.
For templated text, use `$heading: "{{ ... }}"` at the top level, or the full form:

```yaml
heading:
  $heading: "{{ states('sensor.active_lights') }} lights on"
  icon: mdi:lightbulb
```

All options use explicit `$` opt-in, including `$icon` and nested `$url_path`.
Do not set both `heading` and `$heading` in the same object.

Heading templates have their own static heading `config`, with no implicit entity
or group context. Use explicit entity IDs in HA helpers rather than relying on the
inner card's `entity`.

Auto Card forwards `hass`, preview state, and layout state to the child. It forwards
the child's `getGridOptions()` hints, with explicit inner `grid_options` taking
precedence. An optional heading adds to the reported card size and numeric row
hints. It does not introduce a Sections grid or its own column-count setting.

## Visual editor

The editor has **Heading** and **Card** panels. Static cards use their normal native
editor. Cards with safe object-property templates show a **rendered snapshot** in
the native editor, with a note listing template-controlled options.

- Static option edits are merged into the original configuration; `$` sources survive.
- Native initialization/default values are not automatically saved for templated cards.
- Editing a template-controlled value preserves its source and shows feedback. Edit
  the template in Card or Heading YAML instead.
- Backend updates keep the actual preview live without replacing the editor snapshot.
  Switch to YAML and back to request a fresh snapshot.
- Templates inside arrays and templated card types use YAML. Changing card type,
  deleting a templated parent, or replacing its structure also requires YAML.
- Cards without a usable native editor fall back to YAML without dropping options.

Auto Grid uses the same template-protection behavior; its rendered snapshot comes
from the selection query, and its entity picker remains an editor-only sample.
The Heading and Card panels use the exact same option-editor component, including
rendered snapshots, protected template fields, YAML mode, and structural safeguards.

## Updates and errors

Static cards need no template subscription. Identical template plans and static
contexts share subscriptions per HA connection. Rendered option changes reconfigure
the retained child where possible; changing its type, or using a child without
`setConfig()`, replaces it. Ordinary `hass` updates only forward state.

Subscriptions are released when the wrapper disconnects. Template and child-card
creation/configuration failures display an error with Retry; retrying a shared
subscription refreshes all its consumers. There is no frontend template evaluation,
companion integration, or polling. Broad backend templates still have HA's usual
rate limits and costs.
