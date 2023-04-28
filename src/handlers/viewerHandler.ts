import { CanonicalView, PropertyInfo, Viewer, ViewerEvent } from '@speckle/viewer'
import { projectToScreen } from '../utils'
import interpolate from 'color-interpolate'
import { SpeckleVisualSettings } from '../settings'
import { SettingsChangedType, Tracker } from '../mixpanel'

export default class ViewerHandler {
  private viewer: Viewer
  private promises: Promise<void>[]
  private batchSize: number = 25
  private parent: HTMLElement
  private authToken: string = null //TODO: See what can be done to enable private stream fetching.

  public constructor(parent: HTMLElement) {
    this.parent = parent
    this.init()
  }

  public OnObjectClicked: (hit?: any) => void
  public OnObjectDoubleClicked: (hit?: any) => void
  public OnCameraUpdate: () => void

  public changeSettings(oldSettings: SpeckleVisualSettings, newSettings: SpeckleVisualSettings) {
    if (oldSettings.camera.orthoMode != newSettings.camera.orthoMode) {
      Tracker.settingsChanged(SettingsChangedType.OrthoMode)
      if (newSettings.camera.orthoMode) this.viewer.cameraHandler?.setOrthoCameraOn()
      else this.viewer.cameraHandler?.setPerspectiveCameraOn()
    }

    if (oldSettings.camera.defaultView != newSettings.camera.defaultView) {
      Tracker.settingsChanged(SettingsChangedType.DefaultCamera)
      this.viewer.setView(newSettings.camera.defaultView as CanonicalView)
    }
  }

  public async init() {
    if (this.viewer) return

    var container = this.createContainerDiv(this.parent)
    const viewer = new Viewer(container)
    await viewer.init()

    // Setup any events here (progress, load-complete...)
    viewer.on(ViewerEvent.ObjectClicked, this.onObjectClicked)
    viewer.on(ViewerEvent.ObjectDoubleClicked, this.onObjectDoubleClicked)
    viewer.cameraHandler.controls.addEventListener('update', this.onCameraUpdate)

    this.viewer = viewer
  }

  onCameraUpdate(arg: any) {
    throw new Error('Method not implemented.')
  }

  onObjectDoubleClicked(arg: any) {
    if (!arg) return
    var hit = arg.hits[0]
    this.OnObjectDoubleClicked(hit)
    this.selectObjects(hit ? [hit.object.id] : null)
  }
  onObjectClicked(arg: any) {
    if (!arg) return
    var hit = arg.hits[0]
    this.onObjectClicked(hit)
  }

  public async unloadObjects(
    objects: string[],
    signal?: AbortSignal,
    onObjectUnloaded?: (url: string) => void
  ) {
    for (const url of objects) {
      if (signal?.aborted) return
      await this.viewer
        .cancelLoad(url, true)
        .catch((e) => console.warn('Viewer Unload error', url, e))
        .finally(() => {
          if (onObjectUnloaded) onObjectUnloaded(url)
        })
    }
  }

  public async loadObjects(
    objectUrls: string[],
    onLoad: (url: string, index: number) => void,
    onError: (url: string, error: Error) => void,
    doesObjectExist: (url: string) => boolean,
    signal: AbortSignal
  ) {
    var index = 0
    for (const url of objectUrls) {
      if (signal?.aborted) return
      if (!doesObjectExist(url)) {
        var promise = this.viewer
          .loadObject(url, this.authToken, false)
          .catch((e: Error) => onError(url, e))
        this.promises.push(promise)
        if (this.promises.length == this.batchSize) {
          await Promise.all(this.promises)
          this.promises = []
        }
      }
      onLoad(url, index++)
    }
    await Promise.all(this.promises)
    this.promises = []
  }

  public async highlightObjects(
    highlightedValues: powerbi.PrimitiveValue[],
    objectIdColumn: powerbi.PrimitiveValue[]
  ) {
    var objectIds = highlightedValues
      ? highlightedValues
          .map((value, index) => (value ? objectIdColumn[index].toString() : null))
          .filter((e) => e != null)
      : null
    console.log('object ids', objectIds)
    if (objectIds) {
      await this.viewer.resetFilters()
      await this.viewer.isolateObjects(objectIds, null, true, true)
      console.log('isolated filters')
    } else {
      await this.viewer.resetFilters()
      console.log('reset filters')
    }
  }

  public async clearColors() {
    await this.viewer.removeColorFilter()
  }

  public async colorObjects(propertyName: string, colorList: any) {
    var prop = this.viewer.getObjectProperties(null, true).find((item) => item.key == propertyName)

    if (prop.type == 'number') {
      var groups = this.getCustomColorGroups(prop, colorList)
      //@ts-ignore
      await this.viewer.setUserObjectColors(groups)
      console.log('applied numeric filter')
    } else {
      await this.viewer.setColorFilter(prop).catch(async (e) => {
        console.warn('Filter failed to be applied. Filter will be reset', e)
        return await this.viewer.removeColorFilter()
      })
      console.log('applied prop filter')
    }
  }

  public async resetFilters(zoomExtents: boolean = false) {
    await this.viewer.resetFilters()
    this.viewer.zoom()
  }

  public async clear() {
    await this.viewer.unloadAll()
  }

  public async selectObjects(objectIds: string[] = null) {
    if (objectIds == null) this.viewer.resetSelection()
    else this.viewer.selectObjects(objectIds)
  }

  public getScreenPosition(worldPosition): { x: number; y: number } {
    return projectToScreen(this.viewer.cameraHandler.camera, worldPosition)
  }

  private getCustomColorGroups(prop: PropertyInfo, customColors: string[]) {
    var groups: [{ value: number; id?: string; ids?: string[] }] =
      //@ts-ignore
      prop.valueGroups
    if (!groups) return null
    var colorGrad = interpolate(customColors)
    return groups.map((group) => {
      //@ts-ignore
      var color = colorGrad((group.value - prop.min) / (prop.max - prop.min))
      var objectIds = group.ids ?? [group.id]
      return {
        objectIds,
        color
      }
    })
  }

  private createContainerDiv(parent: HTMLElement) {
    var container = parent.appendChild(document.createElement('div'))
    container.style.backgroundColor = 'transparent'
    container.style.height = '100%'
    container.style.width = '100%'
    container.style.position = 'fixed'
    return container
  }
}
