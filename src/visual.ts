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

import interpolate from "color-interpolate"

import { SpeckleVisualSettings } from "./settings"
import {
  Viewer,
  CanonicalView,
  ViewerEvent,
  PropertyInfo
} from "@speckle/viewer"
import * as _ from "lodash"
import {
  VisualUpdateTypeToString,
  cleanupDataColumnName,
  projectToScreen
} from "./utils"
import { SettingsChangedType, Tracker } from "./mixpanel"
import createSampleLandingPage from "./landingPage"
import { SpeckleTooltip } from "./SpeckleTooltip"

type SpeckleSelectionData = {
  id: powerbi.extensibility.ISelectionId
  data: { displayName: string; value: any }[]
}
export class Visual implements IVisual {
  private target: HTMLElement
  private settings: SpeckleVisualSettings
  private host: powerbi.extensibility.IVisualHost
  private selectionManager: powerbi.extensibility.ISelectionManager
  private tooltipService: ITooltipService

  private selectionIdMap: Map<string, SpeckleSelectionData>
  private viewer: Viewer

  private updateTask: Promise<void>
  private ac = new AbortController()
  private currentOrthoMode: boolean = false
  private currentDefaultView: string = "default"
  private currentTooltip: SpeckleTooltip = null

  private isLandingPageOn = false
  private LandingPageRemoved = false

  private LandingPage: Element = null

  constructor(options: VisualConstructorOptions) {
    Tracker.loaded()
    this.host = options.host
    this.selectionIdMap = new Map<string, SpeckleSelectionData>()
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

    this.HandleLandingPage(options)
    if (this.isLandingPageOn) return
    console.log(
      `Update was called with update type ${VisualUpdateTypeToString(
        options.type
      )}`,
      options,
      this.settings
    )

    switch (options.type) {
      case powerbi.VisualUpdateType.Resize:
      case powerbi.VisualUpdateType.ResizeEnd:
      case powerbi.VisualUpdateType.Style:
      case powerbi.VisualUpdateType.ViewMode:
      case powerbi.VisualUpdateType.Resize + powerbi.VisualUpdateType.ResizeEnd:
        // TODO: These cases are not being handled right now, we will skip the update logic.
        // Some are already handled by our viewer, such as resize, but others may require custom implementations in the future.
        return
      default:
        this.debounceUpdate(options)
    }
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

  private getTooltipDataValues(categoricalView: powerbi.DataViewCategorical) {
    if (!categoricalView.values) return // Return nothing
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
      this.selectionIdMap = new Map<string, SpeckleSelectionData>()
      return
    }

    var objectUrls = streamCategory.map(
      (stream, index) => `${stream}/objects/${objectIdCategory[index]}`
    )

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
    var promises = []
    const batchSize = 25
    for (const url of objectUrls) {
      if (signal?.aborted) return
      if (!this.selectionIdMap.has(url)) {
        var promise = this.viewer
          .loadObject(url, null, false)
          .catch((e: Error) => {
            //@ts-ignore
            this.host.displayWarningIcon(
              "Load error",
              `One or more objects could not be loaded
              Please ensure that the stream you're trying to access is PUBLIC
              The Speckle PowerBI Viewer cannot handle private streams yet.`
            )
            console.warn("Viewer Load error:", url, e.name)
          })
        promises.push(promise)
        if (promises.length == batchSize) {
          await Promise.all(promises)
          promises = []
        }
      }
      // We create selection Ids for all objects, regardless if they're there already.
      //@ts-ignore
      var selectionBuilder = this.host.createSelectionIdBuilder()
      var selectionId: powerbi.extensibility.ISelectionId = selectionBuilder
        .withCategory(categoricalView?.categories[1], index)
        .createSelectionId()

      const objectDataColumns = categoricalView.values?.filter(
        v => v.source.roles.objectData
      )
      if (objectDataColumns) {
        const tooltipData = objectDataColumns.map(col => {
          const name = cleanupDataColumnName(col.source.displayName)
          return {
            displayName: name,
            value: col.values[index].toString()
          }
        })
        if (tooltipData.length == 0)
          tooltipData.push({ displayName: "No data", value: null })
        this.selectionIdMap.set(url, {
          id: selectionId,
          data: tooltipData
        })
      }
      index++
    }
    await Promise.all(promises)

    if (signal?.aborted) return
    Tracker.dataReload()

    if (categoricalView?.values) {
      var objectIds = highlightedValues
        ? highlightedValues
            .map((value, index) =>
              value ? objectIdCategory[index].toString() : null
            )
            .filter(e => e != null)
        : null
      console.log("object ids", objectIds)
      if (objectIds) {
        await this.viewer.resetFilters()
        await this.viewer.isolateObjects(objectIds, null, true, true)
        console.log("isolated filters")
      } else {
        await this.viewer.resetFilters()
        console.log("reset filters")
      }

      var objectDataColumns = categoricalView.values.filter(
        v => v.source.roles.objectColorBy
      )

      if (objectDataColumns.length == 0) {
        console.log("removing color filter")
        await this.viewer.removeColorFilter()
      } else {
        var colorList = this.settings.color.getColorList()
        var name = objectDataColumns[0].source.displayName

        var prop = this.viewer
          .getObjectProperties(null, true)
          .find(item => item.key == cleanupDataColumnName(name))

        if (prop.type == "number") {
          var groups = this.getCustomColorGroups(prop, colorList)
          //@ts-ignore
          await this.viewer.setUserObjectColors(groups)
          console.log("applied numeric filter")
        } else {
          await this.viewer.setColorFilter(prop).catch(async e => {
            console.warn("Filter failed to be applied. Filter will be reset", e)
            return await this.viewer.removeColorFilter()
          })
          console.log("applied prop filter")
        }
      }
    } else {
      await this.viewer.resetFilters()
      this.viewer.zoom()
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
    if (!this.currentTooltip) return
    var newScreenLoc = projectToScreen(
      this.viewer.cameraHandler.camera,
      this.currentTooltip.worldPos
    )
    this.currentTooltip.tooltip.coordinates = [newScreenLoc.x, newScreenLoc.y]
    this.tooltipService.move(this.currentTooltip.tooltip)
  }, 1000.0 / 60.0)

  private onObjectClicked = arg => {
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
    this.selectionManager.select(this.selectionIdMap.get(hit.guid).id, false)
  }

  private onObjectDoubleClicked = arg => {
    if (!arg) return
    var hit = arg.hits[0]
    var selectionId = this.selectionIdMap.get(hit.guid).id
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

  private showTooltip(hit: { guid: string; object: any; point: any }) {
    var selectionData = this.selectionIdMap.get(hit.guid)
    const screenLoc = projectToScreen(
      this.viewer.cameraHandler.camera,
      hit.point
    )

    const tooltipData = {
      coordinates: [screenLoc.x, screenLoc.y],
      dataItems: selectionData.data,
      identities: [selectionData.id],
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

  private HandleLandingPage(options: VisualUpdateOptions) {
    if (
      !options.dataViews ||
      !options.dataViews[0]?.metadata?.columns?.length
    ) {
      if (!this.isLandingPageOn) {
        this.isLandingPageOn = true
        this.LandingPage = createSampleLandingPage()
      }
    } else {
      if (this.isLandingPageOn && !this.LandingPageRemoved) {
        this.LandingPageRemoved = true
        this.target.removeChild(this.LandingPage)
        this.isLandingPageOn = false
      }
    }
  }

  private getCustomColorGroups(prop: PropertyInfo, customColors: string[]) {
    var groups: [{ value: number; id?: string; ids?: string[] }] =
      //@ts-ignore
      prop.valueGroups
    if (!groups) return null
    var colorGrad = interpolate(customColors)
    return groups.map(group => {
      //@ts-ignore
      var color = colorGrad((group.value - prop.min) / (prop.max - prop.min))
      var objectIds = group.ids ?? [group.id]
      return {
        objectIds,
        color
      }
    })
  }
}
