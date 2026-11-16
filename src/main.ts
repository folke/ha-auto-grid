import { AutoGrid } from "./card.ts"

if (!customElements.get("auto-grid")) {
  customElements.define("auto-grid", AutoGrid)
  window.customCards ??= []
  window.customCards.push({
    type: "auto-grid",
    name: "Auto Grid",
    description: "An automatically populated grid of Home Assistant cards",
    preview: true,
  })
  console.info("%cAuto Grid v0.1.0 is installed", "color: blue; font-weight: bold")
}
