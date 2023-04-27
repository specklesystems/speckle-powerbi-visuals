import powerbi from 'powerbi-visuals-api'

export type SpeckleSelectionData = {
  id: powerbi.extensibility.ISelectionId
  data: { displayName: string; value: any }[]
}
