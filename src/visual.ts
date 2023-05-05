import 'core-js/stable'
import 'regenerator-runtime/runtime' /* <---- add this line */
import './../style/visual.less'

import powerbi from 'powerbi-visuals-api'
import * as _ from 'lodash'
import { Tracker } from './mixpanel'

import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions
import ITooltipService = powerbi.extensibility.ITooltipService
import IVisual = powerbi.extensibility.visual.IVisual
import EnumerateVisualObjectInstancesOptions = powerbi.EnumerateVisualObjectInstancesOptions
import VisualObjectInstance = powerbi.VisualObjectInstance
import DataView = powerbi.DataView
import VisualObjectInstanceEnumerationObject = powerbi.VisualObjectInstanceEnumerationObject
import IColorPalette = powerbi.extensibility.IColorPalette

import { FormattingSettingsService } from 'powerbi-visuals-utils-formattingmodel'
import { IViewerTooltip, IViewerTooltipData, SpeckleDataInput, SpeckleSelectionData } from './types'
import { VisualUpdateTypeToString, cleanupDataColumnName } from './utils'
import { SpeckleVisualSettings } from './settings'
import ViewerHandler from './handlers/viewerHandler'
import LandingPageHandler from './handlers/landingPageHandler'
import TooltipHandler from './handlers/tooltipHandler'
import SelectionHandler from './handlers/selectionHandler'
import { SpeckleVisualSettingsModel } from './visualSettingsModel'
import { SelectionEvent } from '@speckle/viewer'

export class Visual implements IVisual {
  private target: HTMLElement
  private host: powerbi.extensibility.IVisualHost

  private selectionHandler: SelectionHandler
  private viewerHandler: ViewerHandler
  private landingPageHandler: LandingPageHandler
  private tooltipHandler: TooltipHandler

  private formattingSettings: SpeckleVisualSettingsModel
  private formattingSettingsService: FormattingSettingsService

  private updateTask: Promise<void>
  private ac = new AbortController()

  constructor(options: VisualConstructorOptions) {
    console.log(' - Visual started')
    Tracker.loaded()
    this.host = options.host
    this.target = options.element
    this.formattingSettingsService = new FormattingSettingsService()

    //@ts-ignore
    var palette: IColorPalette = this.host.colorPalette

    console.log(' - Init handlers')
    //@ts-ignore
    this.selectionHandler = new SelectionHandler(this.host)
    this.landingPageHandler = new LandingPageHandler(this.target)
    this.viewerHandler = new ViewerHandler(this.target, palette)
    //@ts-ignore
    this.tooltipHandler = new TooltipHandler(this.host.tooltipService as ITooltipService)

    console.log('Setup handler events')

    this.viewerHandler.OnCameraUpdate = _.throttle(() => {
      this.tooltipHandler.move()
    }, 1000.0 / 60.0).bind(this)
    this.viewerHandler.OnObjectClicked = this.onObjectClicked.bind(this)
    this.viewerHandler.OnObjectRightClicked = (hit, multi) => {
      this.selectionHandler.showContextMenu(hit)
    }
    this.viewerHandler.OnObjectDoubleClicked = this.onObjectDoubleClicked.bind(this)
    this.tooltipHandler.PingScreenPosition = this.viewerHandler.getScreenPosition.bind(
      this.viewerHandler
    )
    this.selectionHandler.PingScreenPosition = this.viewerHandler.getScreenPosition.bind(
      this.viewerHandler
    )

    SpeckleVisualSettings.OnSettingsChanged = ((oldSettings, newSettings) => {
      this.viewerHandler.changeSettings(oldSettings, newSettings)
    }).bind(this)

    //Show landing Page by default
    this.landingPageHandler.show()

    console.log('Visual setup finished')
  }

  private onObjectDoubleClicked(args: SelectionEvent) {
    console.log('DOUBLE CLICKED', args)
  }
  private validateMatrixView(options: VisualUpdateOptions): any {
    const matrixVew = options.dataViews[0].matrix
    console.log('Validating matrix view', matrixVew)
    if (!matrixVew) throw new Error('Data does not contain a matrix data view')

    var hasStream = false,
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

    var objectUrlsToLoad = []
    var objectIds = []
    var selectedIds = []
    var colorByIds = []
    var objectTooltipData = new Map<string, IViewerTooltip>()

    //this.selectionHandler.clear()

    matrixVew.rows.root.children.forEach((streamUrlChild) => {
      var url = streamUrlChild.value

      streamUrlChild.children?.forEach((parentObjectIdChild) => {
        var parentId = parentObjectIdChild.value
        objectUrlsToLoad.push(`${url}/objects/${parentId}`)

        parentObjectIdChild.children?.forEach((colorByChild) => {
          //@ts-ignore
          var color = this.host.colorPalette?.getColor(colorByChild.value as string)
          var colorGroup = {
            color: color.value,
            objectIds: []
          }

          colorByChild.children?.forEach((objectIdChild) => {
            var objId = objectIdChild.value as string
            objectIds.push(`${objId}`)
            colorGroup.objectIds.push(objId)

            // Create selection IDs for each object
            const nodeSelection = this.host
              //@ts-ignore
              .createSelectionIdBuilder()
              .withMatrixNode(objectIdChild, matrixVew.rows.levels)
              .createSelectionId()
            this.selectionHandler.set(objId, nodeSelection)

            // Create value records for the tooltips
            if (objectIdChild.values) {
              var objectData: IViewerTooltipData[] = []
              Object.keys(objectIdChild.values).forEach((key) => {
                var value: powerbi.DataViewMatrixNodeValue = objectIdChild.values[key]
                var k: unknown = key
                var colInfo = matrixVew.valueSources[k as number]
                var isHighlighted = value.highlight != undefined && value.highlight != null
                if (isHighlighted) {
                  selectedIds.push(objId)
                }
                var propData: IViewerTooltipData = {
                  displayName: colInfo.displayName,
                  value: value.value.toString()
                }
                objectData.push(propData)
              })
              objectTooltipData.set(objId, { selectionId: nodeSelection, data: objectData })
            }
          })
          colorByIds.push(colorGroup)
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
      view: matrixVew
    }
  }

  public update(options: VisualUpdateOptions) {
    console.log('Data update')
    var newSettings = Visual.parseSettings(options && options.dataViews && options.dataViews[0])
    //SpeckleVisualSettings.handleSettingsUpdate(newSettings)
    this.formattingSettings = this.formattingSettingsService.populateFormattingSettingsModel(
      SpeckleVisualSettingsModel,
      options.dataViews
    )
    SpeckleVisualSettings.handleSettingsModelUpdate(this.formattingSettings)

    try {
      var input = this.validateMatrixView(options)
      console.log('INPUT: ✅ Valid', input)
      this.landingPageHandler.hide()
    } catch (e) {
      console.log('INPUT: ❌ Not valid', e)
      this.landingPageHandler.show()
      this.selectionHandler.clear()
      //@ts-ignore
      this.host.displayWarningIcon(
        `Incomplete data input.`,
        `"Stream URL" and "Object ID" data inputs are mandatory`
      )
      console.warn(`Incomplete data input. "Stream URL" and "Object ID" data inputs are mandatory`)
      this.ac.abort()
      this.updateTask = this.updateTask
        .then(() => this.viewerHandler.clear())
        .finally(() => this.selectionHandler.reset())
      return
    }

    console.log(
      `Update was called with update type ${VisualUpdateTypeToString(options.type)}`,
      input,
      SpeckleVisualSettings.current
    )

    try {
      switch (options.type) {
        case powerbi.VisualUpdateType.Resize:
        case powerbi.VisualUpdateType.ResizeEnd:
        case powerbi.VisualUpdateType.Style:
        case powerbi.VisualUpdateType.ViewMode:
        case powerbi.VisualUpdateType.Resize + powerbi.VisualUpdateType.ResizeEnd:
          return
        default:
          //this.selectionHandler.setup(input)
          this.tooltipHandler.setup(input.objectTooltipData)
          this.debounceUpdate(input)
      }
    } catch (error) {
      console.error('Data update error', error ?? 'Unknown')
    }
  }

  private async handleDataUpdate(input: any, signal: AbortSignal) {
    if (input.objectsToLoad) {
      this.updateTask = this.viewerHandler
        .loadObjects(input.objectsToLoad, this.onLoad, this.onError, signal)
        .then(async () => {
          console.log('Filtering objects from table', input)
          await this.viewerHandler.colorObjectsByGroup(input.colorByIds)
          if (input.selectedIds.length == 0) {
            console.log('Isolating complete input')
            await this.viewerHandler.isolateObjects(input.objectIds, true)
          } else {
            await this.viewerHandler.selectObjects(input.selectedIds)
            // TODO: Check why this doesn't work with Alex or Dim
            // console.log('Isolating input selection', input.selectedIds, input.objectIds)
            // await this.viewerHandler.unIsolateObjects(input.objectIds)
            // await this.viewerHandler.isolateObjects(input.selectedIds, true)
            // console.log('Finished isolation selection')
          }
        })
        .catch((e) => {
          console.error(`Error loading objects: ${e}`)
        })
    }
  }

  private static parseSettings(dataView: DataView): SpeckleVisualSettings {
    return <SpeckleVisualSettings>SpeckleVisualSettings.parse(dataView)
  }

  /**
   * This function gets called for each of the objects defined in the capabilities files and allows you to select which of the
   * objects and properties you want to expose to the users in the property pane.
   *
   */
  public enumerateObjectInstances(
    options: EnumerateVisualObjectInstancesOptions
  ): VisualObjectInstance[] | VisualObjectInstanceEnumerationObject {
    return SpeckleVisualSettings.enumerateObjectInstances(
      SpeckleVisualSettings.current || SpeckleVisualSettings.getDefault(),
      options
    )
  }

  public getFormattingModel(): powerbi.visuals.FormattingModel {
    return this.formattingSettingsService.buildFormattingModel(this.formattingSettings)
  }

  private debounceUpdate = _.throttle((input: SpeckleDataInput) => {
    this.viewerHandler.init().then(async (_) => {
      if (this.updateTask) {
        this.ac.abort()
        console.log('Cancelling previous load job')
        await this.updateTask
        this.ac = new AbortController()
      }
      console.log('Updating viewer with new data')
      // Handle the update in data passed to this visual
      this.updateTask = this.handleDataUpdate(input, this.ac.signal).then(
        () => (this.updateTask = undefined)
      )
    })
  }, 500)

  private onObjectClicked(hit, multi) {
    console.log('Object was clicked', hit?.object)
    if (hit) {
      const screenLoc = this.viewerHandler.getScreenPosition(hit.point)
      console.log('showing tooltip', screenLoc)
      this.selectionHandler.select(hit.object.id, multi)
      this.tooltipHandler.show(hit, screenLoc)
    } else {
      this.selectionHandler.clear()
      this.tooltipHandler.hide()
    }
  }

  private onLoad(url: string, index: number) {
    console.log(`Loaded object ${url} with index ${index}`)
  }

  private onError(url: string, error: Error) {
    console.warn(`Error loading object ${url} with error`, error)
    //@ts-ignore
    this.host?.displayWarningIcon(
      'Load error',
      `One or more objects could not be loaded 
      Please ensure that the stream you're trying to access is PUBLIC
      The Speckle PowerBI Viewer cannot handle private streams yet.
      `
    )
  }
}
