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

export class Visual implements IVisual {
  private target: HTMLElement
  private settings: SpeckleVisualSettings
  private host: powerbi.extensibility.IVisualHost
  private selectionManager: powerbi.extensibility.ISelectionManager
  private selectionIdMap: Map<string, any>
  private viewer: Viewer

  constructor(options: VisualConstructorOptions) {
    console.log("Speckle 3D Visual constructor called", options)
    this.host = options.host

    this.selectionIdMap = new Map<string, any>()
    //@ts-ignore
    this.selectionManager = this.host.createSelectionManager()

    this.target = options.element
    if (document) {
      this.initViewer()
    }
  }

  public initViewer() {
    var container = this.target.appendChild(document.createElement("div"))
    container.style.backgroundColor = "transparent"
    container.style.height = "100%"
    container.style.width = "100%"
    container.style.position = "fixed"

    const params = DefaultViewerParams
    // Uncomment the line below to show stats
    params.showStats = true

    const viewer = new Viewer(container, params)

    viewer.init().then(() => {
      viewer.onWindowResize()

      viewer.on(
        "load-progress",
        (a: { progress: number; id: string; url: string }) => {
          this.loadedUrls[a.url] = a.progress
          if (a.progress >= 1) {
            viewer.onWindowResize()
          }
        }
      )

      viewer.on("load-complete", () => {
        //console.log("Load complete")
      })

      viewer.on("select", o => {
        if (o.location == null) return
        console.log("viewer object selected", o)
        //var ids = o.userData.map(data => this.selectionIdMap[data.id])
        // this.selectionManager.showContextMenu(ids[0] ?? {}, {
        //   x: rect.top + o.location.x,
        //   y: rect.left + o.location.y
        // })
      })

      this.viewer = viewer
    })
  }

  private loadedUrls = {}

  public update(options: VisualUpdateOptions) {
    this.settings = Visual.parseSettings(
      options && options.dataViews && options.dataViews[0]
    )
    console.log(
      `Update was called with update type ${options.type.toString()}`,
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
    // Handle changes in the visual objects
    this.handleSettingsUpdate(options)
    // Handle the update in data passed to this visual
    return this.handleDataUpdate(options)
  }

  private handleSettingsUpdate(options: VisualUpdateOptions) {
    // Handle change in ortho mode
    if (this.settings.camera.orthoMode)
      this.viewer.cameraHandler.setOrthoCameraOn()
    else this.viewer.cameraHandler.setPerspectiveCameraOn()

    // Handle change in default view
    if (this.settings.camera.defaultView != "perspective")
      this.viewer.interactions.rotateTo(this.settings.camera.defaultView)
  }

  private handleDataUpdate(options: VisualUpdateOptions) {
    var categoricalView = options.dataViews[0].categorical
    var streamCategory = categoricalView?.categories[0].values
    var objectIdCategory = categoricalView?.categories[1].values
    var highlightedValues = categoricalView?.values
      ? categoricalView?.values[0].highlights
      : null

    //@ts-ignore
    var selectionBuilder = this.host.createSelectionIdBuilder()

    var objectUrls = streamCategory.map((stream, index) => {
      var url = `${stream}/objects/${objectIdCategory[index]}`
      return url
    })
    var objectsToUnload = []
    for (const key in this.selectionIdMap.keys()) {
      if (!objectUrls.find(item => item == key)) {
        objectsToUnload.push(key)
      }
    }

    var unloadPromises = objectsToUnload.map(url => {
      return this.viewer.unloadObject(url).then(_ => {
        this.selectionIdMap.delete(url.split("/").slice(-1).pop())
      })
    })

    var loadPromises = objectUrls.map((url, index) => {
      if (!this.selectionIdMap.has(url.split("/").slice(-1).pop())) {
        var selectionId = selectionBuilder.withCategory(
          categoricalView?.categories[1].values[index]
        )
        return this.viewer.loadObject(url, null, false).then(_ => {
          this.selectionIdMap.set(
            categoricalView?.categories[1].values[index].toString(),
            selectionId
          )
        })
      }
    })

    var unloadRes = Promise.all(unloadPromises)
    var loadRes = Promise.all(loadPromises)

    return unloadRes
      .then(_ => loadRes)
      .then(_ => {
        var colorList = this.settings.color.getColorList()
        // Once everything is loaded, run the filter
        var filter = null
        if (categoricalView?.values) {
          var name = categoricalView?.values[0].source.displayName
          var isNum =
            categoricalView?.values[0].source.type.numeric ||
            categoricalView?.values[0].source.type.integer
          var filterType = isNum ? "gradient" : "category"
          console.log("filter:", filterType, name)
          if (highlightedValues)
            filter = {
              filterBy: {
                id: highlightedValues
                  .map((value, index) =>
                    value ? objectIdCategory[index] : null
                  )
                  .filter(e => e != null)
              },
              ghostOthers: true,
              colorBy: {
                type: filterType,
                property: name,
                gradientColors: isNum ? colorList : undefined,
                minValue: categoricalView?.values[0].minLocal,
                maxValue: categoricalView?.values[0].maxLocal
              }
            }
          else
            filter = {
              colorBy: {
                type: filterType,
                property: name
              }
            }
          this.viewer.applyFilter(filter)
        } else {
          console.log("filter: none")
        }
        console.log("filter:", filter)
        this.viewer.applyFilter(filter)
      })
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
