import { formattingSettings as fs } from 'powerbi-visuals-utils-formattingmodel'
import {
  createDataViewWildcardSelector,
  DataViewWildcardMatchingOption
} from 'powerbi-visuals-utils-dataviewutils/lib/dataViewWildcard'
import VisualEnumerationInstanceKinds = powerbi.VisualEnumerationInstanceKinds
import { DefaultLightConfiguration } from '@speckle/viewer'

export class ColorSettings extends fs.Card {
  public enabled = new fs.ToggleSwitch({
    name: 'enabled',
    displayName: 'Enabled',
    value: true,
    topLevelToggle: true
  })

  public fill = new fs.ColorPicker({
    name: 'fill',
    displayName: 'Advanced controls',
    value: { value: '#c5c5c5' },
    defaultColor: { value: '#c5c5c5' },
    selector: createDataViewWildcardSelector(DataViewWildcardMatchingOption.InstancesAndTotals),
    altConstantSelector: {
      static: {}
    },
    instanceKind: VisualEnumerationInstanceKinds.ConstantOrRule
  })

  name = 'color'
  displayName = 'Color'
  slices: fs.Slice[] = [this.enabled, this.fill]
}

export class ColorSelectorSettings extends fs.Card {
  name = 'colorSelector'
  displayName = 'Color Selector'
  slices = []
}
