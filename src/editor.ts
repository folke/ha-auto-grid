import { LitElement, css, html, nothing } from "lit"
import type { TemplateResult } from "lit"
import { keyed } from "lit/directives/keyed.js"
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
} from "./editor-config.ts"
import { normalizeConfig, normalizeResult } from "./query.ts"
import { subscribeTemplate } from "./subscriptions.ts"
import type { AutoGridConfig, CardConfig, GridConfig, Connection, HomeAssistant } from "./types.ts"

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
  private config?: AutoGridConfig
  private previewEntity?: string
  private automaticEntity?: string
  private manualEntity = false
  private previewError?: string
  private previewConfig?: AutoGridConfig
  private previewConnection?: Connection
  private previewKey?: string
  private releasePreview?: () => void
  private previewGeneration = 0
  private code = !customElements.get("hui-card-element-editor")
  private cardError?: string
  private layoutError?: string
  private headingError?: string
  private headingCode = !customElements.get("hui-card-element-editor")
  private headingYaml?: YamlEditor
  private lastHeading?: CardConfig
  private selectionError?: string
  private notice?: string
  private modeVersion = 0
  private expanded: Record<Panel, boolean> = {
    card: false,
    grid: false,
    heading: false,
    selection: true,
  }
  private nativePanels = !!customElements.get("ha-expansion-panel")
  private lastYaml?: Partial<CardConfig>
  private yamlElement?: YamlEditor
  private lastSelection?: Record<string, unknown>
  private selectionElement?: YamlEditor
  private layoutValue?: Record<string, unknown>

  setConfig(config: AutoGridConfig): void {
    if (sameConfig(config, this.config)) return
    headingEditorValue(config)
    const templatesChanged = hasCardTemplates(config.card) !== hasCardTemplates(this.config?.card)
    this.config = structuredClone(config)
    this.layoutValue = layoutData(config)
    this.cardError = undefined
    this.layoutError = undefined
    this.selectionError = undefined
    this.headingError = undefined
    if (templatesChanged) {
      this.code = hasCardTemplates(config.card) || !customElements.get("hui-card-element-editor")
      this.notice = undefined
      this.modeVersion++
    }
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

  private syncPreview(): void {
    if (!this.isConnected || !this.config || !this.hass || this.codeMode) {
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
          this.requestUpdate()
        },
        result: (value) => {
          if (generation !== this.previewGeneration) return
          try {
            this.automaticEntity = normalizeResult(value, compiled).matches[0]?.entity
            this.previewError = undefined
          } catch (error) {
            this.previewError = (error as Error).message
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

  private get codeMode(): boolean {
    return (
      this.code ||
      hasCardTemplates(this.config?.card) ||
      !customElements.get("hui-card-element-editor")
    )
  }

  private emit(config: AutoGridConfig): void {
    if (!this.config || sameConfig(config, this.config)) return
    this.config = structuredClone(config)
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        bubbles: true,
        composed: true,
        detail: { config: structuredClone(config) },
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

  private changeHeading(event: CustomEvent): void {
    event.stopPropagation()
    if (!this.config) return
    const yaml = event.currentTarget === this.headingYaml
    if (
      !yaml &&
      (this.headingCode ||
        event.currentTarget !==
          this.renderRoot.querySelector("hui-card-element-editor.heading-native"))
    )
      return
    if (!yaml && (event.detail.error || event.detail.guiModeAvailable === false)) {
      this.headingCode = true
      this.requestUpdate()
      return
    }
    if (yaml && event.detail.isValid === false)
      // oxlint-disable-next-line typescript/prefer-nullish-coalescing -- Empty editor errors need a fallback.
      this.headingError = event.detail.errorMsg || "Invalid heading YAML"
    else {
      try {
        const config = updateHeading(this.config, yaml ? event.detail.value : event.detail.config)
        this.headingError = undefined
        if (yaml) this.lastHeading = headingEditorValue(config)
        this.emit(config)
      } catch (error) {
        this.headingError = (error as Error).message
      }
    }
    this.requestUpdate()
  }

  private changeSelection(event: CustomEvent): void {
    event.stopPropagation()
    if (!this.config || event.currentTarget !== this.selectionElement) return
    if (event.detail.isValid === false)
      // oxlint-disable-next-line typescript/prefer-nullish-coalescing -- Empty editor errors need a fallback.
      this.selectionError = event.detail.errorMsg || "Invalid selection YAML"
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

  private changeNative(event: CustomEvent): void {
    event.stopPropagation()
    if (
      !this.config ||
      this.codeMode ||
      event.currentTarget !== this.renderRoot.querySelector("hui-card-element-editor.card-native")
    )
      return
    if (event.detail.error || event.detail.guiModeAvailable === false) {
      this.notice =
        // oxlint-disable-next-line typescript/prefer-nullish-coalescing -- Empty editor errors need a fallback.
        event.detail.error ||
        "This card does not support visual editing. Its YAML is preserved below."
      this.code = true
      this.modeVersion++
      this.requestUpdate()
      return
    }
    const value = event.detail.config
    if (!value || typeof value !== "object" || Array.isArray(value)) return
    if (Object.hasOwn(value, "entity") && value.entity !== this.editorEntity) {
      this.previewEntity = typeof value.entity === "string" ? value.entity : undefined
      this.manualEntity = true
    }
    try {
      const config = updateCard(this.config, value, true)
      this.cardError = undefined
      this.emit(config)
    } catch (error) {
      this.cardError = (error as Error).message
    }
    this.requestUpdate()
  }

  private changeYaml(event: CustomEvent): void {
    event.stopPropagation()
    if (!this.config || !this.codeMode || event.currentTarget !== this.yamlElement) return
    if (event.detail.isValid === false)
      // oxlint-disable-next-line typescript/prefer-nullish-coalescing -- Empty editor errors need a fallback.
      this.cardError = event.detail.errorMsg || "Invalid card YAML"
    else {
      try {
        const config = updateCard(this.config, event.detail.value)
        this.cardError = undefined
        this.lastYaml = structuredClone(config.card ?? {})
        this.emit(config)
      } catch (error) {
        this.cardError = (error as Error).message
      }
    }
    this.requestUpdate()
  }

  private toggleMode(): void {
    this.code = !this.codeMode
    this.notice = undefined
    this.cardError = undefined
    this.modeVersion++
    this.requestUpdate()
  }

  protected updated(): void {
    const heading = this.renderRoot.querySelector<YamlEditor>("ha-yaml-editor.heading-yaml")
    if (heading && this.config) {
      const value = headingEditorValue(this.config)
      if (heading !== this.headingYaml || !sameConfig(value, this.lastHeading)) {
        this.headingYaml = heading
        this.lastHeading = structuredClone(value)
        heading.setValue(structuredClone(value))
      }
    }
    if (!heading) this.headingYaml = undefined
    const editor = this.renderRoot.querySelector<YamlEditor>("ha-yaml-editor.card-yaml")
    const value = this.config?.card ?? {}
    if (editor && (editor !== this.yamlElement || !sameConfig(this.lastYaml, value))) {
      this.yamlElement = editor
      this.lastYaml = structuredClone(value)
      editor.setValue(structuredClone(value))
    }
    if (!editor) this.yamlElement = undefined
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
      return html` <ha-expansion-panel
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
        if (event.target !== event.currentTarget) return
        this.expanded[name] = (event.target as HTMLDetailsElement).open
      }}
    >
      <summary>${title}</summary>
      <div class="panel-content">${content}</div>
    </details>`
  }

  /* oxlint-disable typescript/unbound-method -- Lit calls event handlers with the component as this. */
  protected render() {
    if (!this.config || !this.hass) return nothing
    const templates = hasCardTemplates(this.config.card)
    const heading = headingEditorValue(this.config)
    const headingTemplates =
      hasCardTemplates(heading) ||
      (typeof heading.heading === "string" && /{{|{%/.test(heading.heading))
    const headingCode = this.headingCode || headingTemplates
    const nativeAvailable = !!customElements.get("hui-card-element-editor")
    const code = this.codeMode
    let cardHint: TemplateResult | typeof nothing = nothing
    if (templates)
      cardHint = html`<p class="hint">
        This card uses <code>$</code> templates. Edit its YAML to preserve them.
      </p>`
    else if (!nativeAvailable)
      cardHint = html`<p class="hint">
        HA's visual card editor is unavailable. Edit the card YAML below.
      </p>`
    return html`
      ${this.panel(
        "grid",
        "Grid",
        html`
          <ha-form
            .hass=${this.hass}
            .schema=${layoutSchema}
            .data=${this.layoutValue ?? layoutData(this.config)}
            .computeLabel=${(field: { name: string }) => labels[field.name] ?? field.name}
            .computeHelper=${(field: { name: string }) => (field.name === "columns" ? 'A positive number, or "auto" for one horizontal row.' : "")}
            @value-changed=${this.changeLayout}
          ></ha-form>
          ${this.layoutError ? html`<p class="error" role="alert">${this.layoutError}</p>` : nothing}
        `
      )}
      ${this.panel(
        "heading",
        "Heading",
        html`
          <div class="toolbar">
            <button
              ?disabled=${!nativeAvailable || headingTemplates || (this.headingCode && !!this.headingError)}
              @click=${() => {
                this.headingCode = !this.headingCode
                this.headingError = undefined
                this.requestUpdate()
              }}
            >
              ${headingCode ? "Visual editor" : "Heading YAML"}
            </button>
          </div>
          ${
            headingCode
              ? html`<ha-yaml-editor
                  class="heading-yaml"
                  .hass=${this.hass}
                  .defaultValue=${headingEditorValue(this.config)}
                  @value-changed=${this.changeHeading}
                ></ha-yaml-editor>`
              : html` <hui-card-element-editor
                  class="heading-native"
                  .hass=${this.hass}
                  .lovelace=${this.lovelace}
                  .value=${headingEditorValue(this.config)}
                  .showVisibilityTab=${false}
                  @GUImode-changed=${(event: Event) => event.stopPropagation()}
                  @config-changed=${this.changeHeading}
                ></hui-card-element-editor>`
          }
          ${headingTemplates ? html`<p class="hint">This heading uses templates. Edit its YAML to preserve them.</p>` : nothing}
          ${this.headingError ? html`<p class="error" role="alert">${this.headingError}</p>` : nothing}
        `
      )}
      ${this.panel(
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
      )}
      ${this.panel(
        "card",
        "Card",
        html`
          <div class="toolbar">
            <button
              ?disabled=${templates || !nativeAvailable || (code && !!this.cardError)}
              @click=${this.toggleMode}
            >
              ${code ? "Visual editor" : "Card YAML"}
            </button>
          </div>
          ${cardHint} ${this.notice ? html`<p class="hint">${this.notice}</p>` : nothing}
          ${
            code
              ? keyed(
                  `yaml-${this.modeVersion}`,
                  html`<ha-yaml-editor
                    class="card-yaml"
                    .hass=${this.hass}
                    .defaultValue=${structuredClone(this.config.card ?? {})}
                    @value-changed=${this.changeYaml}
                  ></ha-yaml-editor>`
                )
              : html`
                  <p class="hint">
                    The entity is an editor sample, initially the first match; it is never saved.
                  </p>
                  ${this.previewError ? html`<p class="hint">Could not select an editor sample: ${this.previewError}</p>` : nothing}
                  ${keyed(
                    `native-${this.modeVersion}`,
                    html`<hui-card-element-editor
                      class="card-native"
                      .hass=${this.hass}
                      .lovelace=${this.lovelace}
                      .value=${cardEditorValue(this.config, this.editorEntity)}
                      .showVisibilityTab=${false}
                      @GUImode-changed=${(event: Event) => event.stopPropagation()}
                      @config-changed=${this.changeNative}
                    ></hui-card-element-editor>`
                  )}
                `
          }
          ${this.cardError ? html`<p class="error" role="alert">${this.cardError}</p>` : nothing}
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
    .toolbar {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 12px;
    }
    .error {
      color: var(--error-color, #db4437);
      margin-top: 12px;
    }
    button {
      padding: 8px 12px;
      border: 1px solid var(--divider-color, #888);
      border-radius: 8px;
      background: transparent;
      color: var(--primary-color);
      cursor: pointer;
      font: inherit;
    }
    button:disabled {
      cursor: default;
      opacity: 0.5;
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

if (!customElements.get("auto-grid-editor"))
  customElements.define("auto-grid-editor", AutoGridEditor)
