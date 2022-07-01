/*
 *  Power BI Visual CLI
 *
 *  Copyright (c) Microsoft Corporation
 *  All rights reserved.
 *  MIT License
 *
 *  Permission is hereby granted, free of charge, to any person obtaining a copy
 *  of this software and associated documentation files (the ""Software""), to deal
 *  in the Software without restriction, including without limitation the rights
 *  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 *  copies of the Software, and to permit persons to whom the Software is
 *  furnished to do so, subject to the following conditions:
 *
 *  The above copyright notice and this permission notice shall be included in
 *  all copies or substantial portions of the Software.
 *
 *  THE SOFTWARE IS PROVIDED *AS IS*, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 *  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 *  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 *  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 *  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 *  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 *  THE SOFTWARE.
 */
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
  private updateCount: number
  private settings: VisualSettings
  private textNode: Text
  private host: powerbi.extensibility.IVisualHost
  private selectionManager: powerbi.extensibility.ISelectionManager

  constructor(options: VisualConstructorOptions) {
    console.log("Speckle 3D Visual constructor called", options)
    options.host.hostCapabilities.allowInteractions = true

    this.host = options.host
    //@ts-ignore
    this.selectionManager = this.host.createSelectionManager()

    this.target = options.element
    this.updateCount = 0
    if (document) {
      var container = this.target.appendChild(document.createElement("div"))
      container.style.backgroundColor = "transparent"
      container.style.height = "100%"
      container.style.width = "100%"
      container.style.position = "fixed"
      const params = DefaultViewerParams
      params.showStats = true

      const viewer = new Viewer(container, params)
      viewer.init().then(() => {
        viewer.onWindowResize()
        viewer.loadObject(
          "https://latest.speckle.dev/streams/5a8e6d1372/objects/37bb4395d08338c97bb05f814f0ef4d3",
          null,
          false
        )

        viewer.on(
          "load-progress",
          (a: { progress: number; id: string; url: string }) => {
            if (a.progress >= 1) {
              viewer.onWindowResize()
            }
          }
        )

        viewer.on("load-complete", () => {
          console.log("Load complete")
        })

        viewer.on("select", o => {
          console.log("selection-changed", o)
        })
      })
    }
  }

  public update(options: VisualUpdateOptions) {
    this.settings = Visual.parseSettings(
      options && options.dataViews && options.dataViews[0]
    )
    console.log("Visual update", options)
    if (this.textNode) {
      this.textNode.textContent = (this.updateCount++).toString()
    }
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
