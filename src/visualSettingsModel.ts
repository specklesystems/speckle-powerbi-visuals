import { formattingSettings } from 'powerbi-visuals-utils-formattingmodel'
import { SpeckleVisualSettings } from './settings'

import FormattingSettingsCard = formattingSettings.Card
import FormattingSettingsModel = formattingSettings.Model
import FormattingSettingsSlice = formattingSettings.Slice

export class SpeckleVisualSettingsModel extends FormattingSettingsModel {
  // Building my visual formatting settings card
  colorsCard: SpeckleVisualColorSettingsCard = new SpeckleVisualColorSettingsCard()

  // Add formatting settings card to cards list in model
  cards = [this.colorsCard]
}

class SpeckleVisualColorSettingsCard extends FormattingSettingsCard {
  public startColorSlice = new formattingSettings.ColorPicker({
    name: 'startColor',
    displayName: 'Start Color',
    value: { value: '#ffffff' },
    defaultColor: { value: '#ffffff' }
  })

  public midColorSlice = new formattingSettings.ColorPicker({
    name: 'midColor',
    displayName: 'Mid Color',
    value: { value: SpeckleVisualSettings.current.color.midColor }
  })

  public endColorSlice = new formattingSettings.ColorPicker({
    name: 'endColor',
    displayName: 'End Color',
    value: { value: SpeckleVisualSettings.current.color.endColor }
  })

  public backgroundColorSlice = new formattingSettings.ColorPicker({
    name: 'backgroundColor',
    displayName: 'Background Color',
    value: { value: SpeckleVisualSettings.current.color.background }
  })

  name: string = 'speckleVisual_colors'
  displayName: string = 'Colors'
  analyticsPane: boolean = false
  slices: Array<FormattingSettingsSlice> = [
    this.startColorSlice,
    this.midColorSlice,
    this.endColorSlice,
    this.backgroundColorSlice
  ]
}
