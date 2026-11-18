import { decodeTemplateValues } from "./template-values.ts"
import { compileCardOptions, renderCardOptions } from "./card-templates.ts"
import { compileHeadingOptions, validateHeading } from "./heading.ts"
import { subscribeTemplate } from "./subscriptions.ts"
import type { TemplateSubscription } from "./subscriptions.ts"
import type { CardConfig, Connection } from "./types.ts"

export function subscribeCardOptions(
  connection: Connection,
  card: CardConfig,
  consumer: {
    result: (config: CardConfig) => void
    error: (error: Error) => void
    refresh?: () => void
  },
  heading = false
): TemplateSubscription | undefined {
  const plan = heading ? compileHeadingOptions(card) : compileCardOptions(card)
  if (!plan.templates.length) {
    consumer.result(plan.card)
    return undefined
  }
  const prefix = heading ? "ag_heading" : "ag_card"
  const template = [
    ...plan.templates.map(
      ({ source }, index) => `{% macro ${prefix}_${index}() -%}${source}{%- endmacro %}`
    ),
    `[${plan.templates.map((_, index) => `{{ ${prefix}_${index}() | trim | to_json }}`).join(", ")}]`,
  ].join("\n")
  return subscribeTemplate(
    connection,
    template,
    {
      error: consumer.error,
      refresh: consumer.refresh,
      result: (values) => {
        try {
          const rendered = renderCardOptions(
            plan.card,
            plan.templates,
            decodeTemplateValues(values)
          )
          consumer.result(heading ? validateHeading(rendered) : rendered)
        } catch (error) {
          consumer.error(error instanceof Error ? error : new Error(String(error)))
        }
      },
    },
    { config: plan.context, ...(!heading ? { entity: plan.context.entity ?? null } : {}) },
    {
      registries: ["entity", "device", "area", "floor", "label", "integration"],
    }
  )
}
