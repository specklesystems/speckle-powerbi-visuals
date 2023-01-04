"use strict"

import "core-js/stable"
import "regenerator-runtime/runtime" /* <---- add this line */
import "./../style/visual.less"
import powerbi from "powerbi-visuals-api"
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions
import ITooltipService = powerbi.extensibility.ITooltipService
import IVisual = powerbi.extensibility.visual.IVisual
import EnumerateVisualObjectInstancesOptions = powerbi.EnumerateVisualObjectInstancesOptions
import VisualObjectInstance = powerbi.VisualObjectInstance
import DataView = powerbi.DataView
import VisualObjectInstanceEnumerationObject = powerbi.VisualObjectInstanceEnumerationObject

import { SpeckleVisualSettings } from "./settings"
import {
  Viewer,
  CanonicalView,
  ViewerEvent,
  ObjectPredicate
} from "@speckle/viewer"
import * as _ from "lodash"
import {
  VisualUpdateTypeToString,
  cleanupDataColumnName,
  projectToScreen
} from "./utils"
import { SettingsChangedType, Tracker } from "./mixpanel"
import { throttle } from "lodash"

interface SpeckleTooltip {
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

export class Visual implements IVisual {
  private target: HTMLElement
  private settings: SpeckleVisualSettings
  private host: powerbi.extensibility.IVisualHost
  private selectionManager: powerbi.extensibility.ISelectionManager
  private tooltipService: ITooltipService

  private selectionIdMap: Map<string, powerbi.extensibility.ISelectionId>
  private viewer: Viewer

  private updateTask: Promise<void>
  private ac = new AbortController()
  private currentOrthoMode: boolean = false
  private currentDefaultView: string = "default"
  private currentTooltip: SpeckleTooltip = null

  constructor(options: VisualConstructorOptions) {
    Tracker.loaded()
    this.host = options.host
    this.selectionIdMap = new Map<string, powerbi.extensibility.ISelectionId>()
    //@ts-ignore
    this.selectionManager = this.host.createSelectionManager()
    //@ts-ignore
    this.tooltipService = this.host.tooltipService as ITooltipService
    this.target = options.element
  }

  public async initViewer() {
    if (this.viewer) return

    var container = this.createContainerDiv()
    const viewer = new Viewer(container)
    await viewer.init()

    // Setup any events here (progress, load-complete...)
    viewer.on(ViewerEvent.ObjectClicked, this.onObjectClicked)
    viewer.on(ViewerEvent.ObjectDoubleClicked, this.onObjectDoubleClicked)
    viewer.cameraHandler.controls.addEventListener(
      "update",
      this.throttleCameraUpdate
    )

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
      Tracker.settingsChanged(SettingsChangedType.OrthoMode)
    }

    // Handle change in default view
    if (this.currentDefaultView != this.settings.camera.defaultView) {
      this.viewer.setView(this.settings.camera.defaultView as CanonicalView)
      this.currentDefaultView = this.settings.camera.defaultView
      Tracker.settingsChanged(SettingsChangedType.DefaultCamera)
    }

    // Update bg of viewer
    this.target.style.backgroundColor = this.settings.color.background
  }

  private async handleDataUpdate(
    options: VisualUpdateOptions,
    signal: AbortSignal
  ) {
    var categoricalView = options.dataViews[0].categorical
    var streamCategory = categoricalView?.categories[0]?.values
    var objectIdCategory = categoricalView?.categories[1]?.values
    var highlightedValues = categoricalView?.values
      ? categoricalView?.values[0].highlights
      : null
    if (!streamCategory || !objectIdCategory) {
      // If some of the fields are not filled in, unload everything
      //@ts-ignore
      this.host.displayWarningIcon(
        `Incomplete data input.`,
        `"Stream URL" and "Object ID" data inputs are mandatory`
      )
      console.warn(
        `Incomplete data input. "Stream URL" and "Object ID" data inputs are mandatory`
      )
      await this.viewer.unloadAll()
      this.selectionIdMap = new Map<string, any>()
      return
    }

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
      if (!this.selectionIdMap.has(url))
        await this.viewer.loadObject(url, null, false).catch((e: Error) => {
          //@ts-ignore
          this.host.displayWarningIcon(
            "Load error",
            `One or more objects could not be loaded
              Please ensure that the stream you're trying to access is PUBLIC
              The Speckle PowerBI Viewer cannot handle private streams yet.`
          )
          console.warn("Viewer Load error XX", url, e.name)
        })

      //@ts-ignore
      var selectionBuilder = this.host.createSelectionIdBuilder()
      var selectionId = selectionBuilder
        .withCategory(categoricalView?.categories[1], index)
        .createSelectionId()
      this.selectionIdMap.set(url, selectionId)

      index++
    }

    var colorList = this.settings.color.getColorList()
    // Once everything is loaded, run the filter
    var filter = null
    var name = null

    if (signal?.aborted) return
    Tracker.dataReload()
    console.log("Applying filter:", filter)
    if (categoricalView?.values) {
      name = categoricalView?.values[0].source.displayName
      var objectIds = highlightedValues
        ? highlightedValues
            .map((value, index) =>
              value ? objectIdCategory[index].toString() : null
            )
            .filter(e => e != null)
        : null
      if (objectIds) {
        await this.viewer.resetFilters()
        await this.viewer.isolateObjects(objectIds, null, true, true)
      } else {
        await this.viewer.resetFilters()
      }
      var prop = this.viewer
        .getObjectProperties(null, true)
        .find(item => item.key == cleanupDataColumnName(name))
      var state = await this.viewer.setColorFilter(prop).catch(async e => {
        console.warn("Filter failed to be applied. Filter will be reset", e)
        return await this.viewer.removeColorFilter()
      })
    } else {
      await this.viewer.resetFilters()
    }

    this.viewer.zoom()
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
  }, 500)

  private throttleCameraUpdate = _.throttle(options => {
    console.log("Camera updated", this.currentTooltip)
    if (!this.currentTooltip) return
    var newScreenLoc = projectToScreen(
      this.viewer.cameraHandler.camera,
      this.currentTooltip.worldPos
    )
    this.currentTooltip.tooltip.coordinates = [newScreenLoc.x, newScreenLoc.y]
    this.tooltipService.move(this.currentTooltip.tooltip)
  }, 100)

  private onObjectClicked = arg => {
    console.log("object clicked", arg)
    if (!arg) {
      this.tooltipService.hide({ immediately: true, isTouchEvent: false })
      this.currentTooltip = null
      this.viewer.resetSelection()
      this.selectionManager.clear()
      return
    }

    var hit = arg.hits[0]
    this.viewer.selectObjects([hit.object.id])

    this.showTooltip(hit)
    this.selectionManager.select(this.selectionIdMap.get(hit.guid), false)
  }

  private onObjectDoubleClicked = arg => {
    if (!arg) return
    var hit = arg.hits[0]
    var selectionId = this.selectionIdMap.get(hit.guid)
    const screenLoc = projectToScreen(
      this.viewer.cameraHandler.camera,
      hit.point
    )
    this.selectionManager.showContextMenu(selectionId, screenLoc)
  }

  private createContainerDiv() {
    var container = this.target.appendChild(document.createElement("div"))
    container.style.backgroundColor = "transparent"
    container.style.height = "100%"
    container.style.width = "100%"
    container.style.position = "fixed"
    return container
  }

  private showTooltip(hit: any) {
    var selectionId = this.selectionIdMap.get(hit.guid)
    const screenLoc = projectToScreen(
      this.viewer.cameraHandler.camera,
      hit.point
    )
    var dataItems = Object.keys(hit.object)
      .filter(key => !key.startsWith("__"))
      .map(key => {
        return {
          displayName: key,
          value: hit.object[key]
        }
      })

    const tooltipData = {
      coordinates: [screenLoc.x, screenLoc.y],
      dataItems: dataItems,
      identities: [selectionId],
      isTouchEvent: false
    }

    this.currentTooltip = {
      id: hit.object.id,
      worldPos: hit.point,
      screenPos: screenLoc,
      tooltip: tooltipData
    }
    this.tooltipService.show(tooltipData)
  }
}
