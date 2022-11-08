"use strict"

import "core-js/stable"
import "regenerator-runtime/runtime" /* <---- add this line */
import "./../style/visual.less"
import powerbi from "powerbi-visuals-api"
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions
import IVisual = powerbi.extensibility.visual.IVisual
import EnumerateVisualObjectInstancesOptions = powerbi.EnumerateVisualObjectInstancesOptions
import VisualObjectInstance = powerbi.VisualObjectInstance
import DataView = powerbi.DataView
import VisualObjectInstanceEnumerationObject = powerbi.VisualObjectInstanceEnumerationObject

import { SpeckleVisualSettings } from "./settings"
import { Viewer, DefaultViewerParams } from "@speckle/viewer"
import * as _ from "lodash"
import { VisualUpdateTypeToString, cleanupDataColumnName } from "./utils"
export class Visual implements IVisual {
  private target: HTMLElement
  private settings: SpeckleVisualSettings
  private host: powerbi.extensibility.IVisualHost
  private selectionManager: powerbi.extensibility.ISelectionManager
  private selectionIdMap: Map<string, any>
  private viewer: Viewer

  private updateTask: Promise<void>
  private ac = new AbortController()
  private currentOrthoMode: boolean = undefined
  private currentDefaultView: string = undefined

  private debounceWait = 500

  private debounceUpdate = _.debounce(options => {
    this.initViewer().then(async _ => {
      if (this.updateTask) {
        this.ac.abort()
        console.log("Cancelling previous load job")
        await this.updateTask
        this.ac = new AbortController()
      }
      // Handle changes in the visual objects
      this.handleSettingsUpdate(options)
      console.log("Updating viewer with new data")
      // Handle the update in data passed to this visual
      this.updateTask = this.handleDataUpdate(options, this.ac.signal).then(
        () => (this.updateTask = undefined)
      )
    })
  }, this.debounceWait)

  constructor(options: VisualConstructorOptions) {
    this.host = options.host

    this.selectionIdMap = new Map<string, any>()
    //@ts-ignore
    this.selectionManager = this.host.createSelectionManager()

    this.target = options.element
  }

  public async initViewer() {
    if (this.viewer) {
      return
    }

    var container = this.target.appendChild(document.createElement("div"))
    container.style.backgroundColor = "transparent"
    container.style.height = "100%"
    container.style.width = "100%"
    container.style.position = "fixed"

    const params = DefaultViewerParams

    const viewer = new Viewer(container, params)
    await viewer.init()

    // Setup any events here (progress, load-complete...)

    this.viewer = viewer
  }

  public update(options: VisualUpdateOptions) {
    this.settings = Visual.parseSettings(
      options && options.dataViews && options.dataViews[0]
    )

    console.log(
      `Update was called with update type ${VisualUpdateTypeToString(
        options.type
      )}`,
      options,
      this.settings
    )

    // TODO: These cases are not being handled right now, we will skip the update logic.
    // Some are already handled by our viewer, such as resize, but others may require custom implementations in the future.
    switch (options.type) {
      case powerbi.VisualUpdateType.Resize:
      case powerbi.VisualUpdateType.ResizeEnd:
      case powerbi.VisualUpdateType.Style:
      case powerbi.VisualUpdateType.ViewMode:
      case powerbi.VisualUpdateType.Resize + powerbi.VisualUpdateType.ResizeEnd:
        // Ignore case, nothing will happen
        return
    }

    console.log("Data was updated, updating viewer...")
    this.debounceUpdate(options)
  }

  private async handleSettingsUpdate(options: VisualUpdateOptions) {
    // Handle change in ortho mode
    if (this.currentOrthoMode != this.settings.camera.orthoMode) {
      if (this.settings.camera.orthoMode)
        this.viewer?.cameraHandler?.setOrthoCameraOn()
      else this.viewer?.cameraHandler?.setPerspectiveCameraOn()
      this.currentOrthoMode = this.settings.camera.orthoMode
    }

    // Handle change in default view
    if (this.currentDefaultView != this.settings.camera.defaultView) {
      this.viewer.interactions.rotateTo(this.settings.camera.defaultView)
      this.currentDefaultView = this.settings.camera.defaultView
    }

    // Update bg of viewer
    this.target.style.backgroundColor = this.settings.color.background
  }

  private async handleDataUpdate(
    options: VisualUpdateOptions,
    signal: AbortSignal
  ) {
    var categoricalView = options.dataViews[0].categorical
    var streamCategory = categoricalView?.categories[0].values
    var objectIdCategory = categoricalView?.categories[1].values
    var highlightedValues = categoricalView?.values
      ? categoricalView?.values[0].highlights
      : null
    if (streamCategory == undefined || objectIdCategory == undefined) {
      // If some of the fields are not filled in, unload everything
      return await this.viewer.unloadAll()
    }
    //@ts-ignore
    var selectionBuilder = this.host.createSelectionIdBuilder()

    var objectUrls = streamCategory.map((stream, index) => {
      var url = `${stream}/objects/${objectIdCategory[index]}`
      return url
    })
    var objectsToUnload = []
    for (const key of this.selectionIdMap.keys()) {
      const found = objectUrls.find(url => url == key)
      if (!found) {
        objectsToUnload.push(key)
      }
    }

    console.log(
      `Viewer loading ${objectUrls.length} and unloading ${objectsToUnload.length}`
    )

    for (const url of objectsToUnload) {
      if (signal?.aborted) return
      await this.viewer
        .cancelLoad(url, true)
        .then(_ => {
          this.selectionIdMap.delete(url)
        })
        .catch(e => console.warn("Viewer Unload error", url, e))
    }

    var index = 0
    for (const url of objectUrls) {
      if (signal?.aborted) return
      if (!this.selectionIdMap.has(url)) {
        var selectionId = selectionBuilder.withCategory(
          categoricalView?.categories[1].values[index]
        )
        await this.viewer
          .loadObject(url, null, false)
          .then(_ => {
            var url =
              categoricalView?.categories[0].values[index].toString() +
              "/objects/" +
              categoricalView?.categories[1].values[index].toString()
            this.selectionIdMap.set(url, selectionId)
          })
          .catch(e => {
            console.warn("Viewer Load error", url, e)
          })
      }
      index++
    }

    var colorList = this.settings.color.getColorList()
    // Once everything is loaded, run the filter
    var filter = null
    console.log("categorical view", categoricalView)
    if (categoricalView?.values) {
      console.log("values exist?")
      var name = categoricalView?.values[0].source.displayName
      var isNum =
        categoricalView?.values[0].source.type.numeric ||
        categoricalView?.values[0].source.type.integer
      var filterType = isNum ? "gradient" : "category"
      if (highlightedValues)
        filter = {
          filterBy: {
            id: highlightedValues
              .map((value, index) => (value ? objectIdCategory[index] : null))
              .filter(e => e != null)
          },
          ghostOthers: true,
          colorBy: {
            type: filterType,
            property: cleanupDataColumnName(name),
            gradientColors: isNum ? colorList : undefined,
            minValue: categoricalView?.values[0].minLocal,
            maxValue: categoricalView?.values[0].maxLocal
          }
        }
      else
        filter = {
          filterBy: {
            id: objectIdCategory
          },
          colorBy: {
            type: filterType,
            property: cleanupDataColumnName(name),
            gradientColors: isNum ? colorList : undefined,
            minValue: categoricalView?.values[0].minLocal,
            maxValue: categoricalView?.values[0].maxLocal
          }
        }
    }

    if (signal?.aborted) return

    console.log("Applying filter:", filter)
    return await this.viewer
      .applyFilter(filter)
      .catch(e => {
        console.warn("Filter failed to be applied. Filter will be reset", e)
        return this.viewer.applyFilter(null)
      })
      .then(_ => this.viewer.zoomExtents())
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
      this.settings || SpeckleVisualSettings.getDefault(),
      options
    )
  }
}
