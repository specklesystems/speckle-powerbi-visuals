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

import { SpeckleDataInput, SpeckleSelectionData } from './types'
import { VisualUpdateTypeToString, cleanupDataColumnName } from './utils'
import { SpeckleVisualSettings } from './settings'
import ViewerHandler from './handlers/viewerHandler'
import LandingPageHandler from './handlers/landingPageHandler'
import TooltipHandler from './handlers/tooltipHandler'
import SelectionHandler from './handlers/selectionHandler'

export class Visual implements IVisual {
  private target: HTMLElement
  private host: powerbi.extensibility.IVisualHost

  private selectionHandler: SelectionHandler
  private viewerHandler: ViewerHandler
  private landingPageHandler: LandingPageHandler
  private tooltipHandler: TooltipHandler

  private updateTask: Promise<void>
  private ac = new AbortController()

  constructor(options: VisualConstructorOptions) {
    Tracker.loaded()
    this.host = options.host
    this.target = options.element

    //@ts-ignore
    this.selectionHandler = new SelectionHandler(this.host.createSelectionManager())
    //@ts-ignore
    this.tooltipHandler = new TooltipHandler(this.host.tooltipService as ITooltipService)
    this.tooltipHandler.PingScreenPosition = this.viewerHandler.getScreenPosition

    this.landingPageHandler = new LandingPageHandler(this.target)

    this.viewerHandler = new ViewerHandler(this.target)
    this.viewerHandler.OnCameraUpdate = _.throttle(() => {
      this.tooltipHandler.move()
    }, 1000.0 / 60.0)
    this.viewerHandler.OnObjectClicked = this.onObjectClicked
    this.viewerHandler.onObjectDoubleClicked = this.selectionHandler.showContextMenu

    SpeckleVisualSettings.OnSettingsChanged = (oldSettings, newSettings) => {
      this.viewerHandler.changeSettings(oldSettings, newSettings)
    }
  }

  private validateOptions(options: VisualUpdateOptions): SpeckleDataInput {
    if (options.dataViews.length == 0) throw new Error('No Data View was provided')
    if (options.dataViews.length > 1) throw new Error('More than one Data View was provided')
    const categoricalView = options.dataViews[0].categorical
    if (!categoricalView) throw new Error('Data View provided is not Categorical')

    const streamUrlColumn = categoricalView.categories.find((c) => c.source.roles.stream)
    const objectIdColumn = categoricalView.categories.find((c) => c.source.roles.object)

    if (!streamUrlColumn && !objectIdColumn)
      throw new Error('Input is missing Stream ID and Object ID fields')
    else if (!streamUrlColumn) throw new Error('Input is missing Stream ID field')
    else if (!objectIdColumn) throw new Error('Input is missing Object ID field')

    const objectColorByColumn = categoricalView.values.find((v) => v.source.roles.objectColorBy)
    const objectDataColumns = categoricalView.values.filter((v) => v.source.roles.objectData)

    return {
      streamUrlColumn,
      objectIdColumn,
      objectDataColumns,
      objectColorByColumn
    }
  }

  public update(options: VisualUpdateOptions) {
    var newSettings = Visual.parseSettings(options && options.dataViews && options.dataViews[0])
    SpeckleVisualSettings.handleSettingsUpdate(newSettings)

    try {
      var input = this.validateOptions(options)
      this.landingPageHandler.hide()
    } catch (e) {
      this.landingPageHandler.show()
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
      options,
      input,
      SpeckleVisualSettings.current
    )

    switch (options.type) {
      case powerbi.VisualUpdateType.Resize:
      case powerbi.VisualUpdateType.ResizeEnd:
      case powerbi.VisualUpdateType.Style:
      case powerbi.VisualUpdateType.ViewMode:
      case powerbi.VisualUpdateType.Resize + powerbi.VisualUpdateType.ResizeEnd:
        return
      default:
        this.debounceUpdate(input)
    }
  }

  private async handleDataUpdate(input: SpeckleDataInput, signal: AbortSignal) {
    var streamCategory = input.streamUrlColumn.values
    var objectIdCategory = input.objectIdColumn.values

    var objectUrls = streamCategory.map(
      (stream, index) => `${stream}/objects/${objectIdCategory[index]}`
    )
    var objectsToUnload = this.findObjectsToUnload(objectUrls)

    console.log(`Viewer loading ${objectUrls.length} and unloading ${objectsToUnload.length}`)
    if (objectsToUnload.length > 0) await this.viewerHandler.unloadObjects(objectsToUnload, signal)
    await this.viewerHandler.loadObjects(
      objectUrls,
      this.onLoad,
      this.onError,
      (url) => this.selectionHandler.has(url),
      signal
    )

    if (signal?.aborted) return
    Tracker.dataReload()

    // Viewer has finished loading, now we handle coloring and highlight

    if (!input.objectDataColumns && !input.objectColorByColumn) {
      // No extra data, clear pre-existing filters.
      this.viewerHandler.resetFilters()
      return
    }

    // Any of the two is not null, so we can highlight items
    var highlightedValues = (input.objectColorByColumn ?? input.objectDataColumns[0]).highlights
    this.viewerHandler.highlightObjects(highlightedValues, objectIdCategory)

    // If colorBy column exists, we apply color to the model
    if (input.objectColorByColumn) {
      var name = input.objectColorByColumn.source.displayName
      this.viewerHandler.colorObjects(
        cleanupDataColumnName(name),
        SpeckleVisualSettings.current.color.getColorList()
      )
    } else {
      this.viewerHandler.clearColors()
    }
  }

  private findObjectsToUnload(objectUrls: string[]) {
    var objectsToUnload = []
    for (const key of this.selectionHandler.urls()) {
      const found = objectUrls.find((url) => url == key)
      if (!found) {
        objectsToUnload.push(key)
      }
    }
    return objectsToUnload
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

  private debounceUpdate = _.debounce((input: SpeckleDataInput) => {
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

  private onObjectClicked(hit?) {
    if (hit) {
      var selectionData = this.selectionHandler.getData(hit.guid)
      const screenLoc = this.viewerHandler.getScreenPosition(hit.point)
      this.tooltipHandler.show(hit, selectionData, screenLoc)
      this.selectionHandler.select(hit.guid)
    } else {
      this.selectionHandler.clear()
    }
  }

  private onLoad(url: string, index: number) {
    console.log(`Loaded object ${url} with index ${index}`)
  }

  private onError(url: string, error: Error) {
    console.log(`Error loading object ${url} with error`, error)
    //@ts-ignore
    this.host.displayWarningIcon(
      'Load error',
      `One or more objects could not be loaded 
      Please ensure that the stream you're trying to access is PUBLIC
      The Speckle PowerBI Viewer cannot handle private streams yet.
      `
    )
  }
}
