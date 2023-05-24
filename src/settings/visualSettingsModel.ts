import { formattingSettings } from 'powerbi-visuals-utils-formattingmodel'
import { SpeckleVisualSettings } from './'

import FormattingSettingsCard = formattingSettings.Card
import FormattingSettingsModel = formattingSettings.Model
import FormattingSettingsSlice = formattingSettings.Slice

export class SpeckleVisualSettingsModel extends FormattingSettingsModel {
  // Building my visual formatting settings card
  color: SpeckleVisualColorSettingsCard = new SpeckleVisualColorSettingsCard()

  // Add formatting settings card to cards list in model
  cards = [this.color]
}

class SpeckleVisualColorSettingsCard extends FormattingSettingsCard {
  public startColor = new formattingSettings.ColorPicker({
    name: 'startColor',
    displayName: 'Start Color',
    value: { value: '#ffffff' }
  })

  public midColor = new formattingSettings.ColorPicker({
    name: 'midColor',
    displayName: 'Mid Color',
    value: { value: 'yellow' }
  })

  public endColor = new formattingSettings.ColorPicker({
    name: 'endColor',
    displayName: 'End Color',
    value: { value: 'lightblue' }
  })

  public background = new formattingSettings.ColorPicker({
    name: 'background',
    displayName: 'Background Color',
    value: { value: 'green' }
  })

  name = 'color'
  displayName = 'Color'
  slices: FormattingSettingsSlice[] = [
    this.startColor,
    this.midColor,
    this.endColor,
    this.background
  ]
}
