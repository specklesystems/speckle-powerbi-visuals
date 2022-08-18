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

import { VisualSettings } from "./settings"
import { Viewer, DefaultViewerParams } from "@speckle/viewer"

export class Visual implements IVisual {
  private target: HTMLElement
  private settings: VisualSettings
  private host: powerbi.extensibility.IVisualHost
  private selectionManager: powerbi.extensibility.ISelectionManager
  private selectionIdMap: Map<string, any>
  private viewer: Viewer

  constructor(options: VisualConstructorOptions) {
    console.log("Speckle 3D Visual constructor called", options)
    this.host = options.host
    console.log("options module", options.module)

    this.selectionIdMap = new Map<string, any>()
    //@ts-ignore
    this.selectionManager = this.host.createSelectionManager()
    this.selectionManager.registerOnSelectCallback(ids => {
      console.log("powerbi selected something", ids)
    })

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
        //console.log("selection-changed", o)
        if (o.userData.length == 0) {
          return
        }
        //var ids = o.userData.map(data => this.selectionIdMap[data.id][0])
        //this.selectionManager.select(ids)
      })

      this.viewer = viewer
    })
  }

  private loadedUrls = {}

  public update(options: VisualUpdateOptions) {
    console.log("Update was called with options", options)
    this.settings = Visual.parseSettings(
      options && options.dataViews && options.dataViews[0]
    )
    console.log("Settings", this.settings)
    console.log("update type", options.type)
    if (options.type != powerbi.VisualUpdateType.Data) return

    console.log("Update START:", options)

    var categoricalView = options.dataViews[0].categorical
    var streamCategory = categoricalView?.categories[0].values
    var objectIdCategory = categoricalView?.categories[1].values
    var highlightedValues = categoricalView?.values
      ? categoricalView?.values[0].highlights
      : null
    var objectUrls = streamCategory.map(
      (stream, index) => `${stream}/objects/${objectIdCategory[index]}`
    )
    var objectsToUnload = []
    for (const key in this.selectionIdMap.keys()) {
      if (!objectUrls.find(item => item == key)) {
        objectsToUnload.push(key)
      }
    }
    objectsToUnload.forEach(url => {
      this.viewer.unloadObject(url)
      this.selectionIdMap.delete(url)
    })

    var loadedObjects = []
    var promises = objectUrls.map(url => {
      loadedObjects.push(url)
      if (!this.selectionIdMap.has(url)) {
        this.selectionIdMap.set(url, true)
        return this.viewer.loadObject(url, null, false)
      }
    })

    console.log("highlight values", highlightedValues)
    if (highlightedValues) {
      this.viewer.applyFilter({
        filterBy: {
          id: highlightedValues
            .map((value, index) => (value ? objectIdCategory[index] : null))
            .filter(e => e != null)
        },
        colorBy: {
          property: "speckle_type",
          type: "category"
        },
        ghostOthers: true
      })
    } else {
      this.viewer.applyFilter(null)
    }
    return Promise.all(promises)
  }

  private static parseSettings(dataView: DataView): VisualSettings {
    return <VisualSettings>VisualSettings.parse(dataView)
  }

  /**
   * This function gets called for each of the objects defined in the capabilities files and allows you to select which of the
   * objects and properties you want to expose to the users in the property pane.
   *
   */
  public enumerateObjectInstances(
    options: EnumerateVisualObjectInstancesOptions
  ): VisualObjectInstance[] | VisualObjectInstanceEnumerationObject {
    return VisualSettings.enumerateObjectInstances(
      this.settings || VisualSettings.getDefault(),
      options
    )
  }
}
