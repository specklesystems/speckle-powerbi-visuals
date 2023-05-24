import { formattingSettings as fs } from 'powerbi-visuals-utils-formattingmodel'

export class CameraSettings extends fs.Card {
  public defaultView: fs.SimpleSlice = new fs.AutoDropdown({
    name: 'defaultView',
    displayName: 'Default View',
    value: 'perspective'
  })

  public projection = new fs.AutoDropdown({
    name: 'projection',
    displayName: 'Projection',
    value: 'perspective'
  })

  name = 'camera'
  displayName = 'Camera'
  slices: fs.Slice[] = [this.defaultView, this.projection]
}
