'use strict'

import { dataViewObjectsParser } from 'powerbi-visuals-utils-dataviewutils'
import DataViewObjectsParser = dataViewObjectsParser.DataViewObjectsParser
import _ from 'lodash'

export class SpeckleVisualSettings extends DataViewObjectsParser {
  public camera: CameraSettings = new CameraSettings()
  public color: ColorSettings = new ColorSettings()

  public static current: SpeckleVisualSettings = new SpeckleVisualSettings()

  public static async handleSettingsUpdate(newSettings: SpeckleVisualSettings) {
    var same = _.isEqual(this.current, newSettings)
    if (same) return
    this.OnSettingsChanged(this.current, newSettings)
    this.current = newSettings
  }

  public static OnSettingsChanged(oldSettings, newSettings) {}
}

export class CameraSettings {
  // Default color
  public orthoMode: boolean = false
  public defaultView: string = 'default'
}

export class ColorSettings {
  public startColor: string = '#31c116'
  public midColor: string = '#fc8032'
  public endColor: string = '#e70000'
  public background: string = '#ffffff'

  public getColorList() {
    return [this.startColor, this.midColor, this.endColor]
  }
}
