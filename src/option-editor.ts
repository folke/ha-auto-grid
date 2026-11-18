import { LitElement, css, html, nothing } from "lit"
import { keyed } from "lit/directives/keyed.js"
import { validateCardOptions } from "./card-templates.ts"
import { headingConfig } from "./heading.ts"
import {
  hasCardTemplates,
  mergeVisualEdit,
  restoreTemplateValues,
  sameConfig,
  templateEditorInfo,
} from "./editor-config.ts"
import { subscribeCardOptions } from "./standalone-templates.ts"
import type { CardConfig, Connection, HomeAssistant } from "./types.ts"

type YamlEditor = HTMLElement & { setValue: (value: unknown) => void }

export class OptionEditor extends LitElement {
  static properties = {
    external: { type: Boolean },
    hass: { attribute: false },
    heading: { type: Boolean },
    lovelace: { attribute: false },
    nativeValue: { attribute: false },
    requireType: { type: Boolean },
    reserveEntity: { type: Boolean },
    value: { attribute: false },
  }
  declare hass?: HomeAssistant
  declare lovelace?: unknown
  value: Partial<CardConfig> = {}
  declare nativeValue?: CardConfig
  external = false
  reserveEntity = false
  requireType = false
  heading = false
  private source?: Partial<CardConfig>
  private lastNative?: CardConfig
  private snapshot?: CardConfig
  private subscription?: () => void
  private connection?: Connection
  private generation = 0
  private code = !customElements.get("hui-card-element-editor")
  private error?: string
  private notice?: string
  private interacted = false
  private version = 0
  private yaml?: YamlEditor
  private yamlValue?: Partial<CardConfig>
  private interaction = Object.assign(
    () => {
      this.interacted = true
    },
    { capture: true }
  )

  get codeMode(): boolean {
    return (
      this.code ||
      !templateEditorInfo(this.value).safe ||
      !customElements.get("hui-card-element-editor")
    )
  }

  private clearSnapshot(): void {
    this.generation++
    this.subscription?.()
    this.subscription = undefined
    this.connection = undefined
    this.snapshot = undefined
    this.interacted = false
  }

  disconnectedCallback(): void {
    this.clearSnapshot()
    super.disconnectedCallback()
  }

  connectedCallback(): void {
    super.connectedCallback()
    this.requestUpdate()
  }

  protected willUpdate(): void {
    if (!sameConfig(this.source, this.value)) {
      this.clearSnapshot()
      this.source = structuredClone(this.value)
      this.error = undefined
      this.notice = undefined
      this.version++
    }
    const templates = hasCardTemplates(this.value)
    if (!templates && !sameConfig(this.lastNative, this.nativeValue)) {
      this.snapshot = undefined
      this.lastNative = structuredClone(this.nativeValue)
    }
    if (this.codeMode) return
    if (this.external) {
      if (!this.snapshot && this.nativeValue) this.snapshot = structuredClone(this.nativeValue)
      return
    }
    if (!templates || !this.hass || !this.isConnected) return
    if (this.connection === this.hass.connection) return
    this.clearSnapshot()
    this.connection = this.hass.connection
    const generation = this.generation
    const source: CardConfig = { type: this.heading ? "heading" : "tile", ...this.value }
    this.subscription = subscribeCardOptions(
      this.hass.connection,
      source,
      {
        error: (error) => {
          if (generation !== this.generation) return
          this.fallback(`Could not render templates: ${error.message}. Edit the YAML below.`)
        },
        result: (value) => {
          if (generation !== this.generation || this.snapshot) return
          this.snapshot = value
          this.requestUpdate()
        },
      },
      this.heading
    )
  }

  fallback(notice: string): void {
    this.clearSnapshot()
    this.notice = notice
    this.code = true
    this.version++
    this.modeChanged()
    this.requestUpdate()
  }

  private modeChanged(): void {
    this.dispatchEvent(new CustomEvent("mode-changed", { bubbles: true, composed: true }))
  }

  private toggleMode(): void {
    this.code = !this.codeMode
    this.clearSnapshot()
    this.error = undefined
    this.notice = undefined
    this.version++
    this.modeChanged()
    this.requestUpdate()
  }

  private get displayValue(): CardConfig {
    return (
      this.snapshot ??
      this.nativeValue ?? { type: this.heading ? "heading" : "tile", ...this.value }
    )
  }

  private commit(value: unknown, visual: boolean): void {
    if (this.heading && value === undefined)
      value = { heading: "", heading_style: "title", type: "heading" }
    validateCardOptions(value, this.reserveEntity)
    if (this.heading) headingConfig({ heading: value })
    else if (this.requireType && !value.type && !value.$type)
      throw new Error("card.type is required")
    const detail = { error: undefined as string | undefined, value: structuredClone(value), visual }
    const accepted = this.dispatchEvent(
      new CustomEvent("options-changed", {
        bubbles: true,
        cancelable: true,
        composed: true,
        detail,
      })
    )
    if (!accepted) throw new Error(detail.error ?? "Invalid configuration")
    this.value = structuredClone(value)
    this.source = structuredClone(value)
    this.error = undefined
    this.requestUpdate()
  }

  private changeNative(event: CustomEvent): void {
    event.stopPropagation()
    if (
      this.codeMode ||
      event.currentTarget !== this.renderRoot.querySelector("hui-card-element-editor")
    )
      return
    if (event.detail.error || event.detail.guiModeAvailable === false) {
      this.fallback(
        event.detail.error ??
          "This card does not support visual editing. Its YAML is preserved below."
      )
      return
    }
    const value = event.detail.config as CardConfig | undefined
    if (!value || typeof value !== "object" || Array.isArray(value)) return
    try {
      const before = this.displayValue
      if (hasCardTemplates(this.value) && !this.interacted) {
        const initialized = restoreTemplateValues(this.value, before, value)
        if (!sameConfig(initialized, before)) {
          this.snapshot = initialized
          this.requestUpdate()
        }
        return
      }
      if (this.reserveEntity && !this.heading && value.entity !== before.entity)
        this.dispatchEvent(
          new CustomEvent("sample-changed", {
            bubbles: true,
            composed: true,
            detail: { entity: value.entity },
          })
        )
      const merged = mergeVisualEdit(this.value, before, value)
      if (this.reserveEntity) delete merged.card.entity
      this.notice = merged.protectedEdits.length
        ? `Template-controlled options were preserved: ${merged.protectedEdits.join(", ")}. Edit them in YAML.`
        : undefined
      this.snapshot = restoreTemplateValues(this.value, before, value)
      if (!sameConfig(merged.card, this.value)) this.commit(merged.card, true)
      this.error = undefined
    } catch (error) {
      this.error = (error as Error).message
    }
    this.requestUpdate()
  }

  private changeYaml(event: CustomEvent): void {
    event.stopPropagation()
    if (!this.codeMode || event.currentTarget !== this.yaml) return
    if (event.detail.isValid === false)
      this.error = event.detail.errorMsg ?? `Invalid ${this.heading ? "heading" : "card"} YAML`
    else {
      try {
        this.commit(event.detail.value, false)
        this.yamlValue = structuredClone(this.value)
      } catch (error) {
        this.error = (error as Error).message
      }
    }
    this.requestUpdate()
  }

  protected updated(): void {
    const editor = this.renderRoot.querySelector<YamlEditor>("ha-yaml-editor")
    if (editor && (editor !== this.yaml || !sameConfig(this.yamlValue, this.value))) {
      this.yaml = editor
      this.yamlValue = structuredClone(this.value)
      editor.setValue(structuredClone(this.value))
    }
    if (!editor) this.yaml = undefined
  }

  /* oxlint-disable typescript/unbound-method -- Lit binds handlers to the host. */
  protected render() {
    const info = templateEditorInfo(this.value)
    const templates = hasCardTemplates(this.value)
    const code = this.codeMode
    const name = this.heading ? "heading" : "card"
    let label = this.heading ? "Heading YAML" : "Card YAML"
    if (code) label = "Visual editor"
    let content
    if (code)
      content = keyed(
        `yaml-${this.version}`,
        html`<ha-yaml-editor
          class=${`${name}-yaml`}
          .hass=${this.hass}
          .defaultValue=${structuredClone(this.value)}
          @value-changed=${this.changeYaml}
        ></ha-yaml-editor>`
      )
    else if (templates && !this.snapshot)
      content = html`<p class="hint">Resolving an editor snapshot…</p>`
    else
      content = keyed(
        `native-${this.version}`,
        html`<hui-card-element-editor
          class=${`${name}-native`}
          .hass=${this.hass}
          .lovelace=${this.lovelace}
          .value=${this.displayValue}
          .showVisibilityTab=${false}
          @pointerdown=${this.interaction}
          @keydown=${this.interaction}
          @input=${this.interaction}
          @click=${this.interaction}
          @GUImode-changed=${(event: Event) => event.stopPropagation()}
          @config-changed=${this.changeNative}
        ></hui-card-element-editor>`
      )
    return html`
      <div class="toolbar">
        <button
          ?disabled=${!info.safe || !customElements.get("hui-card-element-editor") || (code && !!this.error)}
          @click=${this.toggleMode}
        >
          ${label}
        </button>
      </div>
      ${templates ? html`<p class="hint">${info.safe ? `Template-controlled options: ${info.paths.join(", ")}. Edit their templates in YAML; other options can be edited visually.` : "Templated card types and array entries require YAML editing."}</p>` : nothing}
      ${this.notice ? html`<p class="hint">${this.notice}</p>` : nothing} ${content}
      ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : nothing}
    `
  }
  /* oxlint-enable typescript/unbound-method */

  static styles = css`
    :host {
      display: block;
    }
    .toolbar {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 12px;
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
  `
}

if (!customElements.get("auto-grid-option-editor"))
  customElements.define("auto-grid-option-editor", OptionEditor)
