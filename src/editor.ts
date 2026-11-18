import { LitElement, css, html, nothing } from "lit"
import type { TemplateResult } from "lit"
import {
  cardEditorValue,
  headingEditorValue,
  updateHeading,
  hasCardTemplates,
  layoutData,
  sameConfig,
  selectionData,
  updateCard,
  updateLayout,
  updateSelection,
  templateEditorInfo,
} from "./editor-config.ts"
import { normalizeConfig, normalizeResult } from "./query.ts"
import { subscribeTemplate } from "./subscriptions.ts"
import { compileCardOptions, renderCardOptions } from "./card-templates.ts"
import { OptionEditor } from "./option-editor.ts"
import type {
  AutoCardConfig,
  AutoGridConfig,
  CardConfig,
  GridConfig,
  Connection,
  HomeAssistant,
  TemplateValue,
} from "./types.ts"

type YamlEditor = HTMLElement & { setValue: (value: unknown) => void }
type Panel = "grid" | "heading" | "selection" | "card"
const layoutSchema = [
  { name: "columns", selector: { text: {} } },
  {
    name: "",
    schema: [
      { name: "square", selector: { boolean: {} } },
      { name: "show_empty", selector: { boolean: {} } },
    ],
    type: "grid",
  },
]
const labels: Record<string, string> = {
  columns: "Columns",
  show_empty: "Show when empty",
  square: "Square cards",
}

export async function prepareEditor(): Promise<void> {
  if (customElements.get("ha-expansion-panel")) return
  try {
    const helpers = await window.loadCardHelpers?.()
    const tile = await helpers?.createCardElement({ entity: "sun.sun", type: "tile" })
    const CardClass = tile?.constructor as
      | { getConfigElement?: () => Promise<HTMLElement> | HTMLElement }
      | undefined
    await CardClass?.getConfigElement?.()
  } catch (error) {
    console.warn("Auto Grid: could not load native editor panels", error)
  }
}

export class AutoGridEditor extends LitElement {
  static properties = { hass: { attribute: false }, lovelace: { attribute: false } }
  declare hass?: HomeAssistant
  declare lovelace?: unknown
  protected singleCard = false
  private config?: AutoGridConfig
  private previewEntity?: string
  private automaticEntity?: string
  private manualEntity = false
  private previewError?: string
  private renderedCard?: CardConfig
  private previewConfig?: AutoGridConfig
  private previewConnection?: Connection
  private previewKey?: string
  private releasePreview?: () => void
  private previewGeneration = 0
  private layoutError?: string
  private selectionError?: string
  private expanded: Record<Panel, boolean> = {
    card: false,
    grid: false,
    heading: false,
    selection: true,
  }
  private nativePanels = !!customElements.get("ha-expansion-panel")
  private lastSelection?: Record<string, unknown>
  private selectionElement?: YamlEditor
  private layoutValue?: Record<string, unknown>

  setConfig(input: AutoGridConfig | AutoCardConfig): void {
    const config = this.singleCard
      ? ({ ...input, include: [] } as AutoGridConfig)
      : (input as AutoGridConfig)
    if (sameConfig(config, this.config)) return
    headingEditorValue(config)
    if (!sameConfig(config.card, this.config?.card)) this.renderedCard = undefined
    this.config = structuredClone(config)
    this.layoutValue = layoutData(config)
    this.layoutError = undefined
    this.selectionError = undefined
    this.requestUpdate()
  }

  connectedCallback(): void {
    super.connectedCallback()
    this.requestUpdate()
  }
  disconnectedCallback(): void {
    this.clearPreview()
    super.disconnectedCallback()
  }

  private clearPreview(): void {
    this.previewGeneration++
    this.releasePreview?.()
    this.releasePreview = undefined
    this.previewKey = undefined
    this.previewConnection = undefined
    this.previewConfig = undefined
  }
  private get editorEntity(): string | undefined {
    return this.manualEntity ? this.previewEntity : this.automaticEntity
  }
  private get cardEditor(): OptionEditor | null {
    const editor = this.renderRoot.querySelector("auto-grid-option-editor.card-options")
    return editor instanceof OptionEditor ? editor : null
  }

  private syncPreview(): void {
    if (this.singleCard) {
      this.clearPreview()
      return
    }
    if (
      !this.isConnected ||
      !this.config ||
      !this.hass ||
      !customElements.get("hui-card-element-editor") ||
      !templateEditorInfo(this.config.card).safe ||
      this.cardEditor?.codeMode
    ) {
      this.clearPreview()
      return
    }
    if (this.previewConfig === this.config && this.previewConnection === this.hass.connection)
      return
    this.previewConfig = this.config
    let compiled: GridConfig
    try {
      compiled = normalizeConfig(this.config)
    } catch (error) {
      this.clearPreview()
      this.previewConfig = this.config
      this.previewConnection = this.hass.connection
      this.previewError = (error as Error).message
      this.automaticEntity = undefined
      return
    }
    const query = compiled.query
    const key = JSON.stringify([
      query.template,
      query.registries,
      query.group?.by === "integration",
    ])
    if (key === this.previewKey && this.previewConnection === this.hass.connection) return
    this.clearPreview()
    this.previewConfig = this.config
    this.previewConnection = this.hass.connection
    this.previewKey = key
    this.previewError = undefined
    this.automaticEntity = undefined
    const generation = this.previewGeneration
    this.releasePreview = subscribeTemplate(
      this.hass.connection,
      query.template,
      {
        error: (error) => {
          if (generation !== this.previewGeneration) return
          this.previewError = error.message
          if (hasCardTemplates(this.config?.card) && !this.renderedCard)
            this.cardEditor?.fallback(
              `Could not render an editor snapshot: ${error.message}. Edit the YAML below.`
            )
          this.requestUpdate()
        },
        result: (value) => {
          if (generation !== this.previewGeneration) return
          try {
            const match = normalizeResult(value, compiled).matches.at(0)
            this.automaticEntity = match?.entity
            if (!match && hasCardTemplates(this.config?.card) && !this.renderedCard)
              this.cardEditor?.fallback(
                "No matching entity is available for a rendered editor snapshot. Edit the YAML below."
              )
            if (match && hasCardTemplates(this.config?.card) && !this.renderedCard) {
              const effective = renderCardOptions(
                query.cards[match.group],
                query.templates[match.group],
                match.values,
                match.entity
              )
              const plan = compileCardOptions({ type: "tile", ...this.config?.card })
              const values = plan.templates.map(({ path }) => {
                let child: unknown = effective
                for (const part of path)
                  child = (child as Record<string | number, unknown> | undefined)?.[part]
                return child
              })
              this.renderedCard = renderCardOptions(
                plan.card,
                plan.templates,
                values as TemplateValue[],
                match.entity
              )
            }
            this.previewError = undefined
          } catch (error) {
            this.previewError = (error as Error).message
            if (hasCardTemplates(this.config?.card) && !this.renderedCard)
              this.cardEditor?.fallback(
                `Could not render an editor snapshot: ${this.previewError}. Edit the YAML below.`
              )
          }
          this.requestUpdate()
        },
      },
      undefined,
      { integrationNames: query.group?.by === "integration", registries: query.registries }
    )
  }

  protected willUpdate(): void {
    this.syncPreview()
  }

  private emit(config: AutoGridConfig): void {
    if (!this.config || sameConfig(config, this.config)) return
    this.config = structuredClone(config)
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        bubbles: true,
        composed: true,
        detail: {
          config: this.singleCard
            ? Object.fromEntries(
                Object.entries(structuredClone(config)).filter(([key]) => key !== "include")
              )
            : structuredClone(config),
        },
      })
    )
    this.requestUpdate()
  }

  private changeLayout(event: CustomEvent): void {
    event.stopPropagation()
    if (!this.config) return
    this.layoutValue = event.detail.value
    try {
      const config = updateLayout(this.config, event.detail.value)
      this.layoutError = undefined
      this.emit(config)
    } catch (error) {
      this.layoutError = (error as Error).message
    }
    this.requestUpdate()
  }

  private changeOptions(event: CustomEvent): void {
    event.stopPropagation()
    if (!this.config) return
    try {
      const heading = (event.currentTarget as OptionEditor).heading
      const config = heading
        ? updateHeading(this.config, event.detail.value)
        : updateCard(this.config, event.detail.value, event.detail.visual, this.singleCard)
      this.emit(config)
    } catch (error) {
      event.preventDefault()
      event.detail.error = (error as Error).message
    }
  }

  private changeSelection(event: CustomEvent): void {
    event.stopPropagation()
    if (!this.config || event.currentTarget !== this.selectionElement) return
    if (event.detail.isValid === false)
      this.selectionError = event.detail.errorMsg ?? "Invalid selection YAML"
    else {
      try {
        const config = updateSelection(this.config, event.detail.value)
        this.selectionError = undefined
        this.lastSelection = selectionData(config)
        this.emit(config)
      } catch (error) {
        this.selectionError = (error as Error).message
      }
    }
    this.requestUpdate()
  }

  private modeChanged(event: Event): void {
    event.stopPropagation()
    if (event.currentTarget === this.cardEditor) {
      this.renderedCard = undefined
      this.previewConfig = undefined
    }
    this.requestUpdate()
  }

  protected updated(): void {
    const selection = this.renderRoot.querySelector<YamlEditor>("ha-yaml-editor.selection-yaml")
    const data = this.config ? selectionData(this.config) : {}
    if (
      selection &&
      (selection !== this.selectionElement || !sameConfig(this.lastSelection, data))
    ) {
      this.selectionElement = selection
      this.lastSelection = structuredClone(data)
      selection.setValue(structuredClone(data))
    }
    if (!selection) this.selectionElement = undefined
  }

  private panel(name: Panel, title: string, content: TemplateResult): TemplateResult {
    const change = (event: CustomEvent) => {
      if (event.target !== event.currentTarget) return
      event.stopPropagation()
      this.expanded[name] = event.detail.expanded
      this.requestUpdate()
    }
    if (this.nativePanels)
      return html`<ha-expansion-panel
        class=${name}
        outlined
        .header=${title}
        .expanded=${this.expanded[name]}
        @expanded-changed=${change}
        ><ha-icon
          slot="leading-icon"
          .icon=${{ card: "mdi:card-outline", grid: "mdi:view-grid-outline", heading: "mdi:format-title", selection: "mdi:filter-variant" }[name]}
        ></ha-icon>
        <div class="panel-content">${content}</div></ha-expansion-panel
      >`
    return html`<details
      class=${name}
      ?open=${this.expanded[name]}
      @toggle=${(event: Event) => {
        if (event.target === event.currentTarget)
          this.expanded[name] = (event.target as HTMLDetailsElement).open
      }}
    >
      <summary>${title}</summary>
      <div class="panel-content">${content}</div>
    </details>`
  }

  /* oxlint-disable typescript/unbound-method -- Lit binds handlers to the host. */
  protected render() {
    if (!this.config || !this.hass) return nothing
    let nativeValue = cardEditorValue(this.config, this.editorEntity)
    if (this.singleCard) nativeValue = { type: "tile", ...this.config.card }
    else if (hasCardTemplates(this.config.card)) nativeValue = this.renderedCard!
    return html`
      ${
        this.singleCard
          ? nothing
          : this.panel(
              "grid",
              "Grid",
              html`
                <ha-form
                  .hass=${this.hass}
                  .schema=${layoutSchema}
                  .data=${this.layoutValue ?? layoutData(this.config)}
                  .computeLabel=${(field: { name: string }) => labels[field.name] ?? field.name}
                  .computeHelper=${(field: { name: string }) => (field.name === "columns" ? "auto: wrap at 140px · all: one row · 1–24: fixed count · e.g. 180px: wrap at that minimum width" : "")}
                  @value-changed=${this.changeLayout}
                ></ha-form>
                ${this.layoutError ? html`<p class="error" role="alert">${this.layoutError}</p>` : nothing}
              `
            )
      }
      ${this.panel("heading", "Heading", html`<auto-grid-option-editor class="heading-options" .heading=${true} .hass=${this.hass} .lovelace=${this.lovelace} .value=${headingEditorValue(this.config)} @options-changed=${this.changeOptions} @mode-changed=${this.modeChanged}></auto-grid-option-editor>`)}
      ${
        this.singleCard
          ? nothing
          : this.panel(
              "selection",
              "Selection",
              html`
                <p class="hint">
                  Include, exclude, group, sort, and limit. Use HA's full code editor for other root
                  options.
                </p>
                <div class="selection-editor">
                  <ha-yaml-editor
                    class="selection-yaml"
                    .hass=${this.hass}
                    .defaultValue=${selectionData(this.config)}
                    @value-changed=${this.changeSelection}
                  ></ha-yaml-editor>
                </div>
                ${this.selectionError ? html`<p class="error" role="alert">${this.selectionError}</p>` : nothing}
              `
            )
      }
      ${this.panel(
        "card",
        "Card",
        html`
          ${this.singleCard ? nothing : html`<p class="hint">The entity is an editor sample, initially the first match; it is never saved.</p>`}
          ${this.previewError ? html`<p class="hint">Could not select an editor sample: ${this.previewError}</p>` : nothing}
          <auto-grid-option-editor
            class="card-options"
            .hass=${this.hass}
            .lovelace=${this.lovelace}
            .value=${this.config.card ?? {}}
            .nativeValue=${nativeValue}
            .external=${!this.singleCard}
            .reserveEntity=${!this.singleCard}
            .requireType=${this.singleCard}
            @options-changed=${this.changeOptions}
            @mode-changed=${this.modeChanged}
            @sample-changed=${(event: CustomEvent) => {
              event.stopPropagation()
              this.previewEntity =
                typeof event.detail.entity === "string" ? event.detail.entity : undefined
              this.manualEntity = true
              this.requestUpdate()
            }}
          ></auto-grid-option-editor>
        `
      )}
    `
  }
  /* oxlint-enable typescript/unbound-method */

  static styles = css`
    :host {
      display: block;
    }
    ha-expansion-panel,
    details {
      display: block;
      margin: 16px 0;
      --expansion-panel-summary-padding: 0 16px;
      --expansion-panel-content-padding: 0;
    }
    ha-expansion-panel::part(summary) {
      min-height: 64px;
    }
    ha-expansion-panel[expanded]::part(summary) {
      background: var(--secondary-background-color, #fafafa);
      border-radius: inherit;
    }
    .panel-content {
      padding: 16px;
    }
    ha-icon {
      color: var(--secondary-text-color);
    }
    p {
      line-height: 1.5;
      margin: 0 0 12px;
    }
    .hint {
      color: var(--secondary-text-color);
      font-size: 0.9em;
    }
    .error {
      color: var(--error-color, #db4437);
      margin-top: 12px;
    }
    details {
      border: 1px solid var(--outline-color, #ccc);
      border-radius: 12px;
    }
    summary {
      cursor: pointer;
      padding: 16px;
      font-weight: 500;
    }
  `
}

export class AutoCardEditor extends AutoGridEditor {
  protected singleCard = true
}
if (!customElements.get("auto-card-editor"))
  customElements.define("auto-card-editor", AutoCardEditor)
if (!customElements.get("auto-grid-editor"))
  customElements.define("auto-grid-editor", AutoGridEditor)
