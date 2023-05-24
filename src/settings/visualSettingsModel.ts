import { formattingSettings as fs } from 'powerbi-visuals-utils-formattingmodel'
import { ColorSettings } from 'src/settings/colorSettings'
import { CameraSettings } from 'src/settings/cameraSettings'
import { LightingSettings } from 'src/settings/lightingSettings'

export class SpeckleVisualSettingsModel extends fs.Model {
  // Building my visual formatting settings card
  color: ColorSettings = new ColorSettings()

  camera: CameraSettings = new CameraSettings()

  lighting: LightingSettings = new LightingSettings()

  cards = [this.color, this.camera, this.lighting]
}
