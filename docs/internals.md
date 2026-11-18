# 🔧 Internals

[← README](../README.md) · [Contributing](../CONTRIBUTING.md)

How Auto Grid compiles selection, shares subscriptions, and updates cards without
repeating selection work on ordinary Home Assistant state updates. For the public
YAML contract and examples, see [Configuration](configuration.md).

## 🧭 Architecture

- `src/query.ts` validates configuration and compiles filters, sorting, grouping,
  and explicit card-option templates to Jinja.
- `src/card-templates.ts` validates `$` options and applies their rendered values
  to child-card configuration.
- `src/subscriptions.ts` shares `render_template` subscriptions per HA connection.
- `src/registries.ts` watches metadata dependencies; `src/integrations.ts` caches
  integration display names.
- `src/grid.ts` reconciles selected entities with retained child cards.
- `src/card.ts` renders the grid and native headings and handles HA layout sizing.
- `src/editor.ts` and `src/editor-config.ts` implement the visual editor and its
  configuration boundaries.

## 🔄 Performance and Lifecycle

- One backend query returns entity IDs and winning include-rule indexes, optionally
  with rendered `$` values and organized into typed groups with rendered heading configs.
  Static configuration remains frontend-only unless opted into template `config`
  context. Group headings share that query; there are no per-group or per-option
  subscriptions. A templated main heading has one independent, shared subscription;
  static main headings have none.
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
- Native HA conditional visibility disconnects cards that are not self-hidden,
  releasing their subscriptions. Empty/loading grids opt into staying connected as
  described below. Wrappers that only apply CSS hiding may keep cards subscribed.
  There is no general active-view visibility observer yet.
- Below-the-fold cards and background browser tabs remain subscribed while connected.
- With `show_empty: false`, initial loading and empty results render no placeholder,
  title, or reserved height. Cached cards remain visible while refreshing. An empty
  grid reports `hidden` and emits `card-visibility-changed` so HA also hides its layout
  wrapper, removing Sections grid gaps. While self-hidden, `connectedWhileHidden`
  returns true so `hui-card` keeps it connected and subscribed for query recovery.
  Otherwise that hook is false, preserving normal conditional-visibility cleanup.
  Loading/empty placeholders remain available with `show_empty: true` or in HA's
  editor preview.
- Masonry layouts receive HA's `card-updated` event only when the reported card size
  changes. Initially hidden grids can be redistributed after loading, without a
  loading placeholder or relayout on ordinary `hass` updates.
- Responsive `auto` and pixel-width layouts use CSS `auto-fill`. One ResizeObserver
  per Auto Grid observes its rendered grids, tracking the actual column counts for
  row-size reporting. It performs no selection or child configuration work; resize
  events notify HA only when reported size changes. Fixed and `all` layouts need no
  resize observation. Disconnecting releases all observations.
- Query errors and helper failures are shown in the card, with a Retry button.

## 🗂️ Registry Changes

HA's template registry helpers read fresh metadata but do not themselves subscribe to
registry edits. Auto Grid shares event subscriptions per HA connection for the entity,
device, area, floor, and label registries, plus the native `config_entries/subscribe`
stream and `component_loaded` events for integrations. They are opened only while
an active query needs them.

The compiler collects dependency kinds from include/exclude rules (including nested
rules), sorting, and grouping. For example, area queries depend on entity/device/area
registries, floor queries additionally depend on floors, and label queries depend on
entity/label registries. The default name sort depends on entity/device registries.
Pure state/type queries with `sort: []` need no registry listeners.

Custom Jinja heading templates and Jinja-valued `$` options conservatively depend on
all registry kinds, because they can call arbitrary metadata helpers. Ordinary
Mushroom templates passed through to child cards do not add Auto Grid dependencies.

Relevant edits invalidate each shared query, coalescing bursts with a 100 ms trailing
debounce before reopening its template subscription. Old replies are ignored. Existing
cards remain visible and are reconciled with fresh results; no loading flash or
per-`hass` query work is introduced. Initially empty areas/labels can populate after
membership changes. Dependency matching is by registry kind, not individual entity
or label ID, so an unrelated edit in a relevant registry can still refresh the query.

Registry and explicit-ID candidate queries also use `states | count` once to establish
HA's lifecycle-only dependency. This tracks entity additions/removals without
iterating all states or re-rendering for ordinary state updates. The count is not
part of the returned result. Domain/all-state iteration already tracks lifecycle and
does not need the extra hook. This covers entity creation/removal races, including
YAML integrations without registry entries, while preserving scoped selection.

Config-entry initial snapshots are ignored; subsequent edits, reconnect snapshots,
and integration load events refresh integration-dependent queries and cached manifest
names. Reactivating after an unwatched interval also obtains fresh manifest names.
The last active consumer closes registry listeners and cancels queued refreshes. Native event streams
are allowed for non-admin users on supported HA versions. There is no frontend
registry mirror, polling, or injected `now()` timer. If a registry subscription is
rejected, it is logged to the browser console; normal state tracking continues.

## ⚖️ Backend Trade-offs

The compiler narrows candidates to an area/label/floor/integration, explicit IDs,
or domains/types where it can do so safely. Membership helpers are evaluated once per template render,
not once per entity. OR/NOT-only queries may require a full state scan.

HA can rate-limit templates that iterate all states (typically once per minute), or
all entities of a domain (typically once per second). A scoped candidate list avoids
those broad iteration patterns, though it still reads the states needed for filtering
and sorting. Backend work is reduced in scope, not eliminated.

Registry-driven refreshes are event-based and coalesced rather than synchronous with
the edit. Ordinary state-driven updates remain governed by HA's template dependency
tracking and rate limits.

## 🧩 Card-option Templates

Ordinary static card configuration stays in the frontend. An include override is
merged shallowly with the global card, then the selected entity is injected:
`{ type: "tile", ...globalCard, ...groupCard, entity }`. Each child receives an
independent copy. Overrides treat a static key and its `$` counterpart as the same
destination property.

When an include opts into `$` templates, its effective static configuration is
embedded in the backend query to provide the template's `config` context. Only
rendered values are sent back alongside entity IDs. Editing the context or templates
can therefore reopen the query; purely static card edits do not.

Values render after selection, exclusions, sorting, and limiting. The batched backend
payload carries each macro's rendered text. `src/template-values.ts` decodes each
option once at the subscription/result boundary, before applying it to a child or
heading. It accepts JSON and a safe Python-style data-literal subset without `eval`;
quoted JSON strings explicitly preserve text. Nested strings are never reinterpreted.
`renderCardOptions()` applies already-decoded values and clones containers per child,
so editor snapshots and retained selections do not decode string escapes twice.
Entity selection consumes ordinary strings/lists without field-specific JSON parsing.
There are no
per-card or per-field subscriptions. Changed effective options call `setConfig()`
when available; changing the card type replaces the element.

Each nested Auto Grid owns its own query consumer. Literal entity lists keep child
queries scoped, and disconnecting the parent cleans up connected child consumers.

## 🏷️ Native Headings

Main and group headings are actual native heading cards. They are retained and
reconfigured only when their options change; ordinary `hass` updates are forwarded.
The main heading is independent of the selection query. Group headings accept the same configuration as the main heading, defaulting to
Subtitle instead of Title style. All properties, including heading text, explicitly
opt into templates with `$`. A root `$heading` string normalizes to a heading config
containing `$heading`; ordinary text is literal. Group headings render in the selection query,
with `entity` always an entity ID string. Main heading templates have no implicit
entity/group context. They use the shared subscription machinery and registry
invalidation, and disconnect with the card. Single-group headings remain hidden.

Integration display names come from `manifest/list` and are cached per connection.
Config-entry changes, loaded integrations, and reconnect snapshots invalidate the
cache. Names are passed as variables to the shared template subscription; lookup
failures fall back to raw domains without blocking the grid.

## 📝 Visual Editor

The editor uses HA's internal `hui-card-element-editor`, `ha-yaml-editor`, and
`ha-expansion-panel`. Dependencies are loaded through the native tile card editor,
with card-YAML/native-details fallbacks. These are not stable public APIs, so test
compatibility against live HA versions. The editor is bundled into `auto-grid.js`.

Collapsed panels stay mounted to preserve YAML drafts, cursor positions, and nested
editor state. Config echoes retain editor elements, and invalid drafts do not emit
changes or get reset by edits in another panel. Opening an editor does not persist
default values.

The native card editor receives the first query match as a capability sample. The
sample consumer shares the live preview's query where possible and is released on
disconnect or in card-YAML mode. Manual entity-picker changes remain editor-local;
no sample is persisted as `card.entity` or added to selection.

Selection edits own only `include`, `exclude`, `group`, `sort`, and `limit`. Card edits
own only the global `card`. Other root fields survive these changes. Safe object
`$` properties use a frozen rendered snapshot; visual edits are diffed against that
snapshot and merged into original static options while preserving template sources.
Initialization events can establish native defaults in the snapshot without saving
them. Template-controlled edits are restored with feedback. Arrays containing templates,
templated card types, and unsafe structural changes require YAML. Native editors never
receive `$` keys; ordinary Mushroom Jinja strings pass through untouched.

The Heading and Card panels both instantiate `src/option-editor.ts`. It owns native/
YAML switching, rendered snapshots, initialization guards, template protection,
structural checks, errors, and subscription cleanup. The parent editor only handles
configuration ownership and the grid's entity selection/sample context. Heading
snapshots use the same shared standalone subscription as their live preview, without
an implicit entity context.

## 🪄 Auto Card

`custom:auto-card` wraps one child without selection or a grid. It shares the option
compiler, subscription pool, heading renderer, card helpers, and visual editor with
Auto Grid. Standalone card templates receive static `config` and its optional
`entity` shorthand; headings retain their own context. Static cards do not subscribe.

Each child/heading slot is keyed by its effective configuration and card type.
Generation and revision guards discard stale subscription callbacks and pending
helper results. Retained children receive ordinary `hass` updates without template
or configuration work. Child grid hints are merged with its explicit `grid_options`,
and numeric rows account for the optional heading. See [Auto Card](auto-card.md).

## ⚠️ Configuration Warnings

Normalization returns path-specific warnings with stable codes alongside usable
configuration. Compatibility conversions operate on untrusted input, including
nested boolean rules, before validating the canonical filter types. Equivalent
configurations produce the same query without mutating input. Unknown rules and conflicting values still
throw. Warnings render as a native warning alert only in preview mode, above the
actual card, and are replaced on each configuration update—not on `hass` updates.
