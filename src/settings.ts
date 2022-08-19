"use strict"

import { dataViewObjectsParser } from "powerbi-visuals-utils-dataviewutils"
import DataViewObjectsParser = dataViewObjectsParser.DataViewObjectsParser

export class SpeckleVisualSettings extends DataViewObjectsParser {
  public camera: CameraSettings = new CameraSettings()
}

export class CameraSettings {
  // Default color
  public orthoMode: boolean = false
  public defaultView: string = "default"
}
