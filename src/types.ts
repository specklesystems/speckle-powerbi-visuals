

export interface SpeckleSelectionData {
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
  objectsToLoad: string[]
  objectIds: string[]
  selectedIds: string[]
  colorByIds: { objectIds: string[]; color: string }[]
  objectTooltipData: Map<string, IViewerTooltip>
  view: powerbi.DataViewMatrix
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
