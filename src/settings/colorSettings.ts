import { formattingSettings as fs } from 'powerbi-visuals-utils-formattingmodel'

export class ColorSettings extends fs.Card {
  public start = new fs.ColorPicker({
    name: 'start',
    displayName: 'Start Color',
    value: { value: '#ffffff' }
  })

  public mid = new fs.ColorPicker({
    name: 'mid',
    displayName: 'Mid Color',
    value: { value: 'yellow' }
  })

  public end = new fs.ColorPicker({
    name: 'end',
    displayName: 'End Color',
    value: { value: 'lightblue' }
  })

  public background = new fs.ColorPicker({
    name: 'background',
    displayName: 'Background Color',
    value: { value: 'green' }
  })

  name = 'color'
  displayName = 'Color'
  slices: fs.Slice[] = [this.start, this.mid, this.end, this.background]
}
