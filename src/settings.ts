'use strict'

import { dataViewObjectsParser } from 'powerbi-visuals-utils-dataviewutils'
import DataViewObjectsParser = dataViewObjectsParser.DataViewObjectsParser
import _ from 'lodash'
import { SpeckleVisualSettingsModel } from './visualSettingsModel'
import { CanonicalView } from "@speckle/viewer/dist/IViewer";

export class CameraSettings {
  // Default color
  public orthoMode = false
  public defaultView: CanonicalView = '3D'
}

export class ColorSettings {
  public startColor = '#31c116'
  public midColor = '#fc8032'
  public endColor = '#e70000'
  public background = '#ffffff'
}

export class SpeckleVisualSettings extends DataViewObjectsParser {
  public camera: CameraSettings
  public color: ColorSettings
  public static OnSettingsChanged: (oldSettings, newSettings) => void

  public constructor() {
    super()
    this.camera = new CameraSettings()
    this.color = new ColorSettings()
  }

  public static current: SpeckleVisualSettings = new SpeckleVisualSettings()

  public static async handleSettingsUpdate(newSettings: SpeckleVisualSettings) {
    const same = _.isEqual(this.current, newSettings)
    if (same) return
    this.OnSettingsChanged(this.current, newSettings)
    this.current = newSettings
  }

  public static async handleSettingsModelUpdate(newSettings: SpeckleVisualSettingsModel) {
    this.current.color.background = newSettings.colorsCard.backgroundColorSlice.value.value
  }
}
