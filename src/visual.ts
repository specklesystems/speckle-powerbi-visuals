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
  private viewer: Viewer

  constructor(options: VisualConstructorOptions) {
    console.log("Speckle 3D Visual constructor called", options)
    this.host = options.host
    console.log("options module", options.module)
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
    //params.showStats = true

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
        //var ids = o.userData.map(data => this.objectToSelectionId[data.id][0])
        //console.log("selection ids", ids, this.objectToSelectionId)
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

    if (options.type != powerbi.VisualUpdateType.Data) return

    console.log("Update START:", options)
    var table = options.dataViews[0].table
    var objectsToLoad = table?.rows
    console.log("Update: load", objectsToLoad)

    this.viewer
      .unloadAll()
      .then(() => {
        var objPromises = []
        objectsToLoad.forEach((obj, index) => {
          // const selection: powerbi.extensibility.ISelectionId = this.host
          //   //@ts-ignore
          //   .createSelectionIdBuilder()
          //   .withTable(table, index)
          //   .createSelectionId()

          // this.objectToSelectionId[objId] = [selection, obj[0]]
          try {
            var url = `${obj[0]}/objects/${obj[1]}`
            //console.log("Update: Loading object", url)
            this.loadedUrls[url] = 0
            var res = this.viewer.loadObject(url, null, false).then(() => {
              //console.log("Update: Loaded object", url)
            })
            objPromises.push(res)
          } catch (e) {
            console.warn("error fetching object: " + url, e)
          }
        })
        return Promise.all(objPromises)
      })
      .then(() => {
        //this.viewer.zoomExtents()
        console.log("Update END:", this.loadedUrls)
      })
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
