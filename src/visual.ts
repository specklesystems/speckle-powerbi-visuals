import 'core-js/stable'
import 'regenerator-runtime/runtime'
import './../style/visual.less'

import powerbi from 'powerbi-visuals-api'
import * as _ from 'lodash'
import { FormattingSettingsService } from 'powerbi-visuals-utils-formattingmodel'

import { Tracker } from './utils/mixpanel'
import { SpeckleDataInput } from './types'
import { processMatrixView, validateMatrixView } from './utils/matrixViewUtils'
import { SpeckleVisualSettings } from './settings'
import { SpeckleVisualSettingsModel } from './settings/visualSettingsModel'

import ViewerHandler from './handlers/viewerHandler'
import LandingPageHandler from './handlers/landingPageHandler'
import TooltipHandler from './handlers/tooltipHandler'
import SelectionHandler from './handlers/selectionHandler'

import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions
import IVisual = powerbi.extensibility.visual.IVisual
import ITooltipService = powerbi.extensibility.ITooltipService

// noinspection JSUnusedGlobalSymbols
export class Visual implements IVisual {
  private readonly target: HTMLElement
  private readonly host: powerbi.extensibility.visual.IVisualHost
  private readonly viewerHandler: ViewerHandler

  private selectionHandler: SelectionHandler
  private landingPageHandler: LandingPageHandler
  private tooltipHandler: TooltipHandler
  private formattingSettings: SpeckleVisualSettingsModel
  private formattingSettingsService: FormattingSettingsService
  private updateTask: Promise<void>
  private ac = new AbortController()

  // noinspection JSUnusedGlobalSymbols
  public constructor(options: VisualConstructorOptions) {
    console.log(' - Visual started')
    Tracker.loaded()
    this.host = options.host
    this.target = options.element
    this.formattingSettingsService = new FormattingSettingsService()

    console.log(' - Init handlers')

    this.selectionHandler = new SelectionHandler(this.host)
    this.landingPageHandler = new LandingPageHandler(this.target)
    this.viewerHandler = new ViewerHandler(this.target)
    this.tooltipHandler = new TooltipHandler(this.host.tooltipService as ITooltipService)

    console.log('Setup handler events')

    this.viewerHandler.OnCameraUpdate = _.throttle(() => {
      this.tooltipHandler.move()
    }, 1000.0 / 60.0).bind(this)

    this.viewerHandler.OnObjectClicked = this.onObjectClicked.bind(this)
    this.viewerHandler.OnObjectRightClicked = (hit) => {
      this.selectionHandler.showContextMenu(hit)
    }

    this.tooltipHandler.PingScreenPosition = this.viewerHandler.getScreenPosition.bind(
      this.viewerHandler
    )
    this.selectionHandler.PingScreenPosition = this.viewerHandler.getScreenPosition.bind(
      this.viewerHandler
    )

    SpeckleVisualSettings.OnSettingsChanged = (oldSettings, newSettings) => {
      this.viewerHandler.changeSettings(oldSettings, newSettings)
    }

    //Show landing Page by default
    this.landingPageHandler.show()

    console.log('Visual setup finished')
  }

  private async clear() {
    this.ac.abort()
    await this.updateTask
    await this.viewerHandler.clear()
    this.selectionHandler.clear()
    this.ac = new AbortController()
  }

  public update(options: VisualUpdateOptions) {
    this.formattingSettings = this.formattingSettingsService.populateFormattingSettingsModel(
      SpeckleVisualSettingsModel,
      options.dataViews
    )
    SpeckleVisualSettings.handleSettingsModelUpdate(this.formattingSettings)

    let validationResult = null
    try {
      validationResult = validateMatrixView(options)
      console.log('INPUT: ✅ Valid')
      this.landingPageHandler.hide()
    } catch (e) {
      console.log('INPUT: ❌ Not valid', e)
      this.host.displayWarningIcon(
        `Incomplete data input.`,
        `"Stream URL" and "Object ID" data inputs are mandatory`
      )
      console.warn(`Incomplete data input. "Stream URL" and "Object ID" data inputs are mandatory`)
      this.clear()
      return
    }

    try {
      switch (options.type) {
        case powerbi.VisualUpdateType.Resize:
        case powerbi.VisualUpdateType.ResizeEnd:
        case powerbi.VisualUpdateType.Style:
        case powerbi.VisualUpdateType.ViewMode:
        case powerbi.VisualUpdateType.Resize + powerbi.VisualUpdateType.ResizeEnd:
          return
        default:
          var input = processMatrixView(validationResult.view, this.host, (obj, id) =>
            this.selectionHandler.set(obj, id)
          )
          this.tooltipHandler.setup(input.objectTooltipData)
          this.throttleUpdate(input)
      }
    } catch (error) {
      console.error('Data update error', error ?? 'Unknown')
    }
  }

  private async handleDataUpdate(input: SpeckleDataInput, signal: AbortSignal) {
    await this.viewerHandler.loadObjects(input.objectsToLoad, this.onLoad, this.onError, signal)
    if (signal.aborted) {
      console.warn('Aborted')
      return
    }
    await this.viewerHandler.colorObjectsByGroup(input.colorByIds)

    if (input.selectedIds.length == 0)
      await this.viewerHandler.isolateObjects(input.objectIds, true)
    else await this.viewerHandler.isolateObjects(input.selectedIds, true)
  }

  public getFormattingModel(): powerbi.visuals.FormattingModel {
    return this.formattingSettingsService.buildFormattingModel(this.formattingSettings)
  }

  private throttleUpdate = _.throttle((input: SpeckleDataInput) => {
    this.viewerHandler.init().then(async () => {
      if (this.updateTask) {
        this.ac.abort()
        console.log('Cancelling previous load job')
        await this.updateTask
        this.ac = new AbortController()
      }
      console.log('Updating viewer with new data')
      // Handle the update in data passed to this visual
      this.updateTask = this.handleDataUpdate(input, this.ac.signal).then(() => {
        this.ac = new AbortController()
        this.updateTask = undefined
      })
    })
  }, 500)

  private onObjectClicked(hit, multi) {
    console.log('Object was clicked', hit?.object)
    if (hit) {
      const screenLoc = this.viewerHandler.getScreenPosition(hit.point)
      console.log('showing tooltip', screenLoc)
      this.selectionHandler.select(hit.object.id, multi)
      this.tooltipHandler.show(hit, screenLoc)
    } else {
      this.selectionHandler.clear()
      this.tooltipHandler.hide()
    }
  }

  private onLoad(url: string, index: number) {
    console.log(`Loaded object ${url} with index ${index}`)
  }

  private onError(url: string, error: Error) {
    console.warn(`Error loading object ${url} with error`, error)
    this.host.displayWarningIcon(
      'Load error',
      `One or more objects could not be loaded 
      Please ensure that the stream you're trying to access is PUBLIC
      The Speckle PowerBI Viewer cannot handle private streams yet.
      `
    )
  }

  public async destroy() {
    await this.clear()
    this.viewerHandler.dispose()
  }
}
