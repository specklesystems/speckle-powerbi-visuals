import powerbi from "powerbi-visuals-api"

import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions
import {IViewerTooltip, IViewerTooltipData, SpeckleDataInput} from "./types";
import {FilteringState, SelectionEvent} from "@speckle/viewer";

export function VisualUpdateTypeToString(type: powerbi.VisualUpdateType) {
  switch (type) {
    case powerbi.VisualUpdateType.Resize:
      return 'Resize'
    case powerbi.VisualUpdateType.ResizeEnd:
      return 'ResizeEnd'
    case powerbi.VisualUpdateType.Style:
      return 'Style'
    case powerbi.VisualUpdateType.ViewMode:
      return 'ViewMode'
    case powerbi.VisualUpdateType.Resize + powerbi.VisualUpdateType.ResizeEnd:
      return 'Resize+ResizeEnd'
    case powerbi.VisualUpdateType.Data:
      return 'Data'
    case powerbi.VisualUpdateType.All:
      return 'All'
  }
}

export function projectToScreen(cam: any, loc: any) {
  cam.updateProjectionMatrix()
  const copy = loc.clone();
  copy.project(cam)
  return {
    x: (copy.x * 0.5 + 0.5) * window.innerWidth - 10,
    y: (copy.y * -0.5 + 0.5) * window.innerHeight
  }
}

export function validateMatrixView(options: VisualUpdateOptions): {
  hasColorFilter: boolean
  view: powerbi.DataViewMatrix
} {
  const matrixVew = options.dataViews[0].matrix
  console.log('Validating matrix view', matrixVew)
  if (!matrixVew) throw new Error('Data does not contain a matrix data view')

  let hasStream = false,
      hasParentObject = false,
      hasObject = false,
      hasColorFilter = false;

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

export function processMatrixView(
  matrixView: powerbi.DataViewMatrix,
  host: powerbi.extensibility.visual.IVisualHost,
  onSelectionPair: (objId: string, selectionId: powerbi.extensibility.ISelectionId) => void
): SpeckleDataInput {
  const objectUrlsToLoad = []
  const objectIds = []
  const selectedIds = []
  const colorByIds = []
  const objectTooltipData = new Map<string, IViewerTooltip>()

  matrixView.rows.root.children.forEach((streamUrlChild) => {
    const url = streamUrlChild.value

    streamUrlChild.children?.forEach((parentObjectIdChild) => {
      const parentId = parentObjectIdChild.value
      objectUrlsToLoad.push(`${url}/objects/${parentId}`)

      parentObjectIdChild.children?.forEach((colorByChild) => {
        const color = host.colorPalette.getColor(colorByChild.value as string)
        const colorGroup = {
          color: color.value,
          objectIds: []
        }

        colorByChild.children?.forEach((objectIdChild) => {
          const objId = objectIdChild.value as string
          objectIds.push(`${objId}`)

          // Create selection IDs for each object
          const nodeSelection = host
            .createSelectionIdBuilder()
            .withMatrixNode(objectIdChild, matrixView.rows.levels)
            .createSelectionId()
          onSelectionPair(objId, nodeSelection)
          let shouldColor = true
          // Create value records for the tooltips
          if (objectIdChild.values) {
            const objectData: IViewerTooltipData[] = [];
            Object.keys(objectIdChild.values).forEach((key) => {
              const value: powerbi.DataViewMatrixNodeValue = objectIdChild.values[key];
              const k: unknown = key;
              const colInfo = matrixView.valueSources[k as number];
              const highLightActive = value.highlight !== undefined;
              if (highLightActive) shouldColor = false
              const isHighlighted = value.highlight !== null;

              if (highLightActive && isHighlighted) {
                selectedIds.push(objId)
                shouldColor = true
              }
              console.log('🖌️ Object highlight active/highlighted', {
                highLightActive,
                isHighlighted,
                shouldColor,
                value
              })
              const propData: IViewerTooltipData = {
                displayName: colInfo.displayName,
                value: value.value.toString()
              }
              objectData.push(propData)
            })
            objectTooltipData.set(objId, { selectionId: nodeSelection, data: objectData })
          }
          console.log('🖌️ Pushing object to color group?', shouldColor, objId)
          if (shouldColor) colorGroup.objectIds.push(objId)
        })
        if (colorGroup.objectIds.length > 0) colorByIds.push(colorGroup)
      })
    })
  })
  console.log(objectUrlsToLoad)

  return {
    objectsToLoad: objectUrlsToLoad,
    objectIds,
    selectedIds,
    colorByIds,
    objectTooltipData,
    view: matrixView
  }
}

export function getFirstViewableHit(arg: SelectionEvent, state: FilteringState) {
  let hit = null
  if (state.isolatedObjects) {
    // Find the first hit contained in the isolated objects
    hit = arg?.hits.find((hit) => {
      const hitId = hit.object.id as string
      return state.isolatedObjects.includes(hitId)
    })
  }
  return hit
}

export function createViewerContainerDiv(parent: HTMLElement) {
  const container = parent.appendChild(document.createElement('div'));
  container.style.backgroundColor = 'transparent'
  container.style.height = '100%'
  container.style.width = '100%'
  container.style.position = 'fixed'
  return container
}
