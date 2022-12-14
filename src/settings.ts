"use strict"

import { dataViewObjectsParser } from "powerbi-visuals-utils-dataviewutils"
import DataViewObjectsParser = dataViewObjectsParser.DataViewObjectsParser

export class SpeckleVisualSettings extends DataViewObjectsParser {
  public camera: CameraSettings = new CameraSettings()
  public color: ColorSettings = new ColorSettings()
}

export class CameraSettings {
  // Default color
  public orthoMode: boolean = false
  public defaultView: string = "default"
}

export class ColorSettings {
  public startColor: string = "#31c116"
  public midColor: string = "#fc8032"
  public endColor: string = "#e70000"
  public background: string = "#ffffff"

  public getColorList() {
    return [this.startColor, this.midColor, this.endColor]
  }
}
