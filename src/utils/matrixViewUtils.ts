import powerbi from 'powerbi-visuals-api'
import { IViewerTooltip, IViewerTooltipData, SpeckleDataInput } from '../types'
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions
import { hasRole } from 'powerbi-visuals-utils-dataviewutils/lib/dataRoleHelper'
import { LOD } from 'three'

export function validateMatrixView(options: VisualUpdateOptions): {
  hasColorFilter: boolean
  view: powerbi.DataViewMatrix
} {
  const matrixVew = options.dataViews[0].matrix
  if (!matrixVew) throw new Error('Data does not contain a matrix data view')

  let hasStream = false,
    hasParentObject = false,
    hasObject = false,
    hasColorFilter = false

  matrixVew.rows.levels.forEach((level) => {
    level.sources.forEach((source) => {
      if (!hasStream) hasStream = source.roles['stream'] != undefined
      if (!hasParentObject) hasParentObject = source.roles['parentObject'] != undefined
      if (!hasObject) hasObject = source.roles['object'] != undefined
      if (!hasColorFilter) hasColorFilter = source.roles['objectColorBy'] != undefined
    })
  })

  if (!hasStream) throw new Error('Missing Stream ID input')
  if (!hasParentObject) throw new Error('Missing Commit Object ID input')
  if (!hasObject) throw new Error('Missing Object Id input')
  return {
    hasColorFilter,
    view: matrixVew
  }
}

function processObjectValues(
  objectIdChild: powerbi.DataViewMatrixNode,
  matrixView: powerbi.DataViewMatrix
) {
  const objectData: IViewerTooltipData[] = []
  let shouldColor = true,
    shouldSelect = false

  Object.keys(objectIdChild.values).forEach((key) => {
    const value: powerbi.DataViewMatrixNodeValue = objectIdChild.values[key]
    const k: unknown = key
    const colInfo = matrixView.valueSources[k as number]
    const highLightActive = value.highlight !== undefined
    if (highLightActive) shouldColor = false
    const isHighlighted = value.highlight !== null

    if (highLightActive && isHighlighted) {
      shouldSelect = true
      shouldColor = true
    }
    const propData: IViewerTooltipData = {
      displayName: colInfo.displayName,
      value: value.value.toString()
    }
    objectData.push(propData)
  })
  return { data: objectData, shouldColor, shouldSelect }
}

function processObjectNode(
  objectIdChild: powerbi.DataViewMatrixNode,
  host: powerbi.extensibility.visual.IVisualHost,
  matrixView: powerbi.DataViewMatrix
) {
  const objId = objectIdChild.value as string
  // Create selection IDs for each object
  const nodeSelection = host
    .createSelectionIdBuilder()
    .withMatrixNode(objectIdChild, matrixView.rows.levels)
    .createSelectionId()

  // Create value records for the tooltips
  if (objectIdChild.values) {
    var objectValues = processObjectValues(objectIdChild, matrixView)
  }
  return { id: objId, selectionId: nodeSelection, ...objectValues }
}

function processObjectIdLevel(
  parentObjectIdChild: powerbi.DataViewMatrixNode,
  host: powerbi.extensibility.visual.IVisualHost,
  matrixView: powerbi.DataViewMatrix
) {
  return parentObjectIdChild.children?.map((objectIdChild) =>
    processObjectNode(objectIdChild, host, matrixView)
  )
}

var previousPalette = null
var previousPaletteKey = null
export function processMatrixView(
  matrixView: powerbi.DataViewMatrix,
  host: powerbi.extensibility.visual.IVisualHost,
  hasColorFilter: boolean,
  onSelectionPair: (objId: string, selectionId: powerbi.extensibility.ISelectionId) => void
): SpeckleDataInput {
  const objectUrlsToLoad = [],
    objectIds = [],
    selectedIds = [],
    colorByIds = [],
    objectTooltipData = new Map<string, IViewerTooltip>()
  matrixView.rows.root.children.forEach((streamUrlChild) => {
    const url = streamUrlChild.value

    streamUrlChild.children?.forEach((parentObjectIdChild) => {
      const parentId = parentObjectIdChild.value
      objectUrlsToLoad.push(`${url}/objects/${parentId}`)

      if (!hasColorFilter) {
        console.log('🖌️❌ NO COLOR FILTER')
        processObjectIdLevel(parentObjectIdChild, host, matrixView).forEach((objRes) => {
          objectIds.push(objRes.id)
          onSelectionPair(objRes.id, objRes.selectionId)
          if (objRes.shouldSelect) selectedIds.push(objRes.id)
          objectTooltipData.set(objRes.id, {
            selectionId: objRes.selectionId,
            data: objRes.data
          })
        })
      } else {
        if (previousPalette) host.colorPalette['colorPalette'] = previousPalette
        parentObjectIdChild.children?.forEach((colorByChild) => {
          const color = host.colorPalette.getColor(colorByChild.value as string)
          const colorGroup = {
            color: color.value,
            objectIds: []
          }
          processObjectIdLevel(colorByChild, host, matrixView).forEach((objRes) => {
            objectIds.push(objRes.id)
            onSelectionPair(objRes.id, objRes.selectionId)

            if (objRes.shouldSelect) selectedIds.push(objRes.id)
            if (objRes.shouldColor) {
              colorGroup.objectIds.push(objRes.id)
            }
            objectTooltipData.set(objRes.id, {
              selectionId: objRes.selectionId,
              data: objRes.data
            })
          })
          if (colorGroup.objectIds.length > 0) colorByIds.push(colorGroup)
        })
        previousPaletteKey = queryName
      }
    })
  })

  previousPalette = host.colorPalette['colorPalette']

  return {
    objectsToLoad: objectUrlsToLoad,
    objectIds,
    selectedIds,
    colorByIds: colorByIds.length > 0 ? colorByIds : null,
    objectTooltipData,
    view: matrixView
  }
}
