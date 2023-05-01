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
import DataViewObjects = powerbi.DataViewObjects

import DataViewValueColumns = powerbi.DataViewValueColumns
import DataViewValueColumnGroup = powerbi.DataViewValueColumnGroup
import DataViewObjectPropertyIdentifier = powerbi.DataViewObjectPropertyIdentifier

import { SpeckleDataInput, SpeckleSelectionData } from './types'
import { VisualUpdateTypeToString, cleanupDataColumnName } from './utils'
import { SpeckleVisualSettings } from './settings'
import ViewerHandler from './handlers/viewerHandler'
import LandingPageHandler from './handlers/landingPageHandler'
import TooltipHandler from './handlers/tooltipHandler'
import SelectionHandler from './handlers/selectionHandler'
import { ColorHelper } from 'powerbi-visuals-utils-colorutils'

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
    console.log(' - Visual started')
    Tracker.loaded()
    this.host = options.host
    this.target = options.element

    console.log(' - Init handlers')
    //@ts-ignore
    this.selectionHandler = new SelectionHandler(this.host)
    this.landingPageHandler = new LandingPageHandler(this.target)
    this.viewerHandler = new ViewerHandler(this.target)
    //@ts-ignore
    this.tooltipHandler = new TooltipHandler(this.host.tooltipService as ITooltipService)

    console.log('Setup handler events')

    this.viewerHandler.OnCameraUpdate = _.throttle(() => {
      this.tooltipHandler.move()
    }, 1000.0 / 60.0).bind(this)
    this.viewerHandler.OnObjectClicked = this.onObjectClicked.bind(this)
    this.viewerHandler.OnObjectDoubleClicked = this.selectionHandler.showContextMenu
    this.tooltipHandler.PingScreenPosition = this.viewerHandler.getScreenPosition

    SpeckleVisualSettings.OnSettingsChanged = ((oldSettings, newSettings) => {
      this.viewerHandler.changeSettings(oldSettings, newSettings)
    }).bind(this)

    //Show landing Page by default
    this.landingPageHandler.show()

    console.log('Visual setup finished')
  }

  private validateOptions(options: VisualUpdateOptions): SpeckleDataInput {
    console.log('Validating input', options)
    if (options.dataViews.length == 0) throw new Error('No Data View was provided')
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
    const valueColumns = categoricalView.values
    return {
      streamUrlColumn,
      objectIdColumn,
      objectDataColumns,
      objectColorByColumn,
      valueColumns
    }
  }

  public update(options: VisualUpdateOptions) {
    console.log('Data update')
    var newSettings = Visual.parseSettings(options && options.dataViews && options.dataViews[0])
    SpeckleVisualSettings.handleSettingsUpdate(newSettings)

    try {
      var input = this.validateOptions(options)
      console.log('input validated', input)
      this.landingPageHandler.hide()
    } catch (e) {
      console.log('validation went wrong', e)
      this.viewerHandler.clear()
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
          this.selectionHandler.setup(input)
          this.tooltipHandler.setup(options.dataViews[0].categorical)
          console.log('Update data call')
          this.debounceUpdate(input)
      }
    } catch (error) {
      console.error('Data update error', error ?? 'Unknown')
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
    console.log(this.viewerHandler)
    if (objectsToUnload.length > 0) await this.viewerHandler.unloadObjects(objectsToUnload, signal)
    await this.viewerHandler.loadObjects(
      objectUrls,
      this.onLoad,
      this.onError,
      (url) => {
        var exists = this.selectionHandler.has(url)
        console.log('Checking for object existing', url, exists)
        return exists
      },
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
    console.log('Highlighting objects', highlightedValues)
    this.viewerHandler.highlightObjects(highlightedValues, objectIdCategory)

    // If colorBy column exists, we apply color to the model
    if (input.objectColorByColumn) {
      //@ts-ignore
      var palette = this.host.colorPalette
      console.log('Coloring objects', palette)
      let colorHelper: ColorHelper = new ColorHelper(palette)

      let color = colorHelper.getColorForSeriesValue(null, 'WC')
      let color2 = colorHelper.getColorForSeriesValue(null, 'Hall')
      let color3 = colorHelper.getColorForSeriesValue(null, 'Office')
      console.log('color for measure', color, color2, color3)

      var expr = input.objectColorByColumn.source.expr
      var ref = expr['ref'] ?? expr['arg']['ref'] // Not sure why this class has no autocomplete
      console.log('ref', ref)
      this.viewerHandler.colorObjects(
        cleanupDataColumnName(ref),
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
    console.log('Object was clicked', hit)
    if (hit) {
      var selectionId = this.selectionHandler.getData(hit.guid)
      const screenLoc = this.viewerHandler.getScreenPosition(hit.point)
      console.log('showing tooltip', selectionId, screenLoc)
      //this.tooltipHandler.show(hit, selectionData, screenLoc)
      this.selectionHandler.select(hit.guid)
    } else {
      this.selectionHandler.clear()
    }
  }

  private onLoad(url: string, index: number) {
    //console.log(`Loaded object ${url} with index ${index}`)
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
