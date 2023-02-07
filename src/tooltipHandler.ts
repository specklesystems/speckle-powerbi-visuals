import powerbi from "powerbi-visuals-api"
import ITooltipService = powerbi.extensibility.ITooltipService
import { cleanupDataColumnName } from "./utils"

export default class TooltipHandler {
  private data: Map<string, any>
  private tooltipService: ITooltipService

  constructor(tooltipService) {
    this.tooltipService = tooltipService
  }

  setup(categoricalView: powerbi.DataViewCategorical) {
    if (!categoricalView.values) return // Stop if no values are added, as there will be no tooltip data

    const streamColumn = categoricalView.categories.find(
      c => c.source.roles.stream
    )
    const objectColumn = categoricalView.categories.find(
      c => c.source.roles.object
    )
    const objectDataColumns = categoricalView.values.filter(
      v => v.source.roles.objectData
    )

    for (let index = 0; index < streamColumn.values.length; index++) {
      const stream = streamColumn[index]
      const object = objectColumn[index]
      const url = `${stream}/object/${object}`
      const tooltipData = objectDataColumns.map(col => {
        const name = cleanupDataColumnName(col.source.displayName)
        return {
          displayName: name,
          value: col.values[index].toString()
        }
      })
      this.data.set(url, tooltipData)
    }
  }
}
