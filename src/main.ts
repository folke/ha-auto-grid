import { AutoGrid } from "./card.ts"

if (!customElements.get("auto-grid")) {
  customElements.define("auto-grid", AutoGrid)
  window.customCards ??= []
  window.customCards.push({
    description: "An automatically populated grid of Home Assistant cards",
    name: "Auto Grid",
    preview: true,
    type: "auto-grid",
  })
  // oxlint-disable-next-line no-console
  console.info("%cAuto Grid v0.1.0 is installed", "color: blue; font-weight: bold")
}
