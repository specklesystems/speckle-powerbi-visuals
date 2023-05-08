export interface IViewerTooltipData {
  displayName: string
  value: string
}

export interface IViewerTooltip {
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
