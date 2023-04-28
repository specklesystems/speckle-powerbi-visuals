import powerbi from 'powerbi-visuals-api'
import ITooltipService = powerbi.extensibility.ITooltipService
import { cleanupDataColumnName } from '../utils'
import _ from 'lodash'
import { IViewerTooltipData, SpeckleTooltip } from '../types'

export default class TooltipHandler {
  private data: Map<string, IViewerTooltipData[]>
  private tooltipService: ITooltipService
  public currentTooltip: SpeckleTooltip = null

  public PingScreenPosition: (worldPosition) => { x: number; y: number } = null

  constructor(tooltipService) {
    this.tooltipService = tooltipService
    this.data = new Map<string, IViewerTooltipData[]>()
  }

  public setup(categoricalView: powerbi.DataViewCategorical) {
    console.log('Tooltip handler setup', categoricalView)
    if (!categoricalView.values) return // Stop if no values are added, as there will be no tooltip data

    const streamColumn = categoricalView.categories.find((c) => c.source.roles.stream)
    const objectColumn = categoricalView.categories.find((c) => c.source.roles.object)
    const objectDataColumns = categoricalView.values.filter((v) => v.source.roles.objectData)

    this.data = new Map<string, IViewerTooltipData[]>()
    for (let index = 0; index < streamColumn.values.length; index++) {
      const stream = streamColumn[index]
      const object = objectColumn[index]
      const url = `${stream}/object/${object}`
      const tooltipData: IViewerTooltipData[] = objectDataColumns.map((col) => ({
        displayName: cleanupDataColumnName(col.source.displayName),
        value: col.values[index].toString()
      }))
      this.data.set(url, tooltipData)
    }
  }

  public show(hit: { guid: string; object: any; point: any }, selectionData, screenLoc) {
    const tooltipData = {
      coordinates: [screenLoc.x, screenLoc.y],
      dataItems: selectionData.data,
      identities: [selectionData.id],
      isTouchEvent: false
    }

    this.currentTooltip = {
      id: hit.object.id,
      worldPos: hit.point,
      screenPos: screenLoc,
      tooltip: tooltipData
    }

    this.tooltipService.show(tooltipData)
  }

  public hide() {
    this.tooltipService.hide({ immediately: true, isTouchEvent: false })
    this.currentTooltip = null
  }

  public move() {
    if (!this.currentTooltip) return
    var pos = this.PingScreenPosition(this.currentTooltip.worldPos)
    this.currentTooltip.tooltip.coordinates = [pos.x, pos.y]
    this.tooltipService.move(this.currentTooltip.tooltip)
  }
}
