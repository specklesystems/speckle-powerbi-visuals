import 'core-js/stable'
import 'regenerator-runtime/runtime'
import '../style/visual.css'

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
import { isMultiSelect } from './utils/isMultiSelect'

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
  private moved = false

  // noinspection JSUnusedGlobalSymbols
  public constructor(options: VisualConstructorOptions) {
    Tracker.loaded()
    this.host = options.host
    this.target = options.element
    this.formattingSettingsService = new FormattingSettingsService()

    console.log('🚀 Init handlers')

    this.selectionHandler = new SelectionHandler(this.host)
    this.landingPageHandler = new LandingPageHandler(this.target)
    this.viewerHandler = new ViewerHandler(this.target)
    this.tooltipHandler = new TooltipHandler(this.host.tooltipService as ITooltipService)

    console.log('🚀 Setup handler events')

    this.target.addEventListener('pointerdown', this.onPointerDown)
    this.target.addEventListener('pointerup', this.onPointerUp)

    this.target.addEventListener('click', this.onClick)
    this.target.addEventListener('auxclick', this.onAuxClick)

    this.viewerHandler.OnCameraUpdate = _.throttle((args) => {
      this.tooltipHandler.move()
    }, 1000.0 / 60.0).bind(this)

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

    try {
      console.log('🔍 Validating input...', options)
      var validationResult = validateMatrixView(options)
      console.log('✅Input valid', validationResult)
      this.landingPageHandler.hide()
    } catch (e) {
      console.log('❌Input not valid:', (e as Error).message)
      this.host.displayWarningIcon(
        `Incomplete data input.`,
        `"Stream URL" and "Object ID" data inputs are mandatory`
      )
      console.warn(`Incomplete data input. "Stream URL" and "Object ID" data inputs are mandatory`)
      this.clear()
      this.landingPageHandler.show()
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
          var input = processMatrixView(
            validationResult.view,
            this.host,
            validationResult.hasColorFilter,
            (obj, id) => this.selectionHandler.set(obj, id)
          )
          this.tooltipHandler.setup(input.objectTooltipData)
          this.throttleUpdate(input)
      }
    } catch (error) {
      console.error('Data update error', error ?? 'Unknown')
    }
  }

  private async handleDataUpdate(input: SpeckleDataInput, signal: AbortSignal) {
    console.log('DATA UPDATE', input)
    await this.viewerHandler.selectObjects(null)
    await this.viewerHandler.loadObjectsWithAutoUnload(
      input.objectsToLoad,
      this.onLoad,
      this.onError,
      signal
    )
    if (signal.aborted) {
      console.warn('Aborted')
      return
    }

    await this.viewerHandler.colorObjectsByGroup(input.colorByIds)
    await this.viewerHandler.unIsolateObjects()
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
      // Handle the update in data passed to this visual
      this.updateTask = this.handleDataUpdate(input, this.ac.signal).then(() => {
        this.ac = new AbortController()
        this.updateTask = undefined
      })
    })
  }, 500)

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

  private onPointerMove = (_) => {
    this.moved = true
  }
  private onPointerDown = (_) => {
    this.moved = false
    this.target.addEventListener('pointermove', this.onPointerMove)
  }
  private onPointerUp = (_) => {
    this.target.removeEventListener('pointermove', this.onPointerMove)
  }

  private onClick = async (ev) => {
    if (this.moved) return
    const intersectResult = await this.viewerHandler.intersect({ x: ev.clientX, y: ev.clientY })
    const multi = isMultiSelect(ev)
    const hit = intersectResult?.hit
    if (hit) {
      const id = hit.object.id as string

      if (multi || !this.selectionHandler.isSelected(id))
        await this.selectionHandler.select(id, multi)

      this.tooltipHandler.show(hit, { x: ev.clientX, y: ev.clientY })
      const selection = this.selectionHandler.getCurrentSelection()
      const ids = selection.map((s) => s.id)
      await this.viewerHandler.selectObjects(ids)
    } else {
      this.tooltipHandler.hide()
      if (!multi) {
        this.selectionHandler.clear()
        await this.viewerHandler.selectObjects(null)
      }
    }
  }
  private onAuxClick = async (ev) => {
    if (ev.button != 2 || this.moved) return
    const intersectResult = await this.viewerHandler.intersect({ x: ev.clientX, y: ev.clientY })
    await this.selectionHandler.showContextMenu(ev, intersectResult?.hit)
  }

  public async destroy() {
    await this.clear()
    this.viewerHandler.dispose()
    this.target.removeEventListener('pointerup', this.onPointerUp)
    this.target.removeEventListener('pointerdown', this.onPointerDown)
    this.target.removeEventListener('click', this.onClick)
    this.target.removeEventListener('auxclick', this.onAuxClick)
  }
}
