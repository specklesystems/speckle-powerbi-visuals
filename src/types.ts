export type SpeckleSelectionData = {
  id: powerbi.extensibility.ISelectionId
  data: IViewerTooltipData[]
}

export type IViewerTooltipData = {
  displayName: string
  value: string
}

export type IViewerTooltip = {
  selectionId: powerbi.extensibility.ISelectionId
  data: IViewerTooltipData[]
}

export type SpeckleDataInput = {
  streamUrlColumn: powerbi.DataViewCategoryColumn
  objectIdColumn: powerbi.DataViewCategoryColumn
  objectDataColumns?: powerbi.DataViewValueColumn[]
  objectColorByColumn?: powerbi.DataViewValueColumn
  valueColumns: powerbi.DataViewValueColumns
}

export interface SpeckleTooltip {
  worldPos: {
    x: number
    y: number
    z: number
  }
  screenPos: {
    x: number
    y: number
  }
  tooltip: any
  id: string
}
