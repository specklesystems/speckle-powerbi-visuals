import {
  CanonicalView,
  FilteringState,
  PropertyInfo,
  Viewer,
  ViewerEvent,
  SelectionEvent
} from '@speckle/viewer'
import { projectToScreen } from '../utils'
import { SpeckleVisualSettings } from '../settings'
import { SettingsChangedType, Tracker } from '../mixpanel'

import IColorPalette = powerbi.extensibility.IColorPalette
import { keys } from 'lodash'

export default class ViewerHandler {
  private viewer: Viewer
  private promises: Promise<void>[]
  private batchSize: number = 25
  private parent: HTMLElement
  private authToken: string = null //TODO: See what can be done to enable private stream fetching.
  private palette: IColorPalette
  private currentSelection: Set<string> = new Set<string>()
  public loadedObjectsCache: Set<string> = new Set<string>()

  public constructor(parent: HTMLElement, palette: IColorPalette) {
    this.parent = parent
    this.promises = []
    this.palette = palette
  }
  public state: FilteringState

  public OnObjectClicked: (hit: any, multi: boolean) => void
  public OnObjectRightClicked: (hit: any, multi: boolean) => void
  public OnObjectDoubleClicked: (hit: any) => void
  public OnCameraUpdate: () => void

  public changeSettings(oldSettings: SpeckleVisualSettings, newSettings: SpeckleVisualSettings) {
    console.log('Changing settings in viewer')
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
    console.log('Initializing viewer')
    var container = this.createContainerDiv(this.parent)
    const viewer = new Viewer(container, {
      verbose: false,
      keepGeometryData: true,
      environmentSrc: null,
      showStats: true
    })
    await viewer.init()

    // Setup any events here (progress, load-complete...)
    viewer.on(ViewerEvent.ObjectDoubleClicked, this.objectDoubleClicked.bind(this))
    viewer.on(ViewerEvent.ObjectClicked, this.objectClicked.bind(this))
    viewer.cameraHandler.controls.addEventListener('update', this.onCameraUpdate.bind(this))

    this.viewer = viewer
    console.log('Viewer initialized')
  }

  private onCameraUpdate(arg: any) {
    if (this.OnCameraUpdate) this.OnCameraUpdate()
  }

  private objectDoubleClicked(arg: any) {
    console.log('Double clicked', arg)
    var hit = this.getFirstViewableHit(arg)
    if (this.OnObjectDoubleClicked) this.OnObjectDoubleClicked(hit)
  }
  private async objectClicked(arg: SelectionEvent) {
    console.log('viewer clicked event', arg)
    var button = arg?.event?.button ?? 0
    var multi = arg?.event?.ctrlKey ?? false
    var hit = this.getFirstViewableHit(arg)

    if (button == 2) {
      if (this.OnObjectRightClicked) this.OnObjectRightClicked(hit, multi)
    } else if (button == 0) {
      if (this.OnObjectClicked) this.OnObjectClicked(hit, multi)

      if (hit && multi) {
        this.currentSelection.add(hit.object.id)
      } else if (hit && !multi) {
        this.currentSelection.clear()
        this.currentSelection.add(hit.object.id)
      } else if (!multi) {
        this.currentSelection.clear()
      }

      await this.selectObjects([...this.currentSelection.keys()])
    }
  }

  private getFirstViewableHit(arg: SelectionEvent) {
    var hit = null
    if (this.state?.isolatedObjects) {
      // Find the first hit contained in the isolated objects
      hit = arg?.hits.find((hit) => {
        var hitId = hit.object.id as string
        return this.state.isolatedObjects.includes(hitId)
      })
      if (hit) console.log('Found viewable hit', hit)
    }
    return hit
  }

  public async unloadObjects(
    objects: string[],
    signal?: AbortSignal,
    onObjectUnloaded?: (url: string) => void
  ) {
    console.log('Unloading objects', this)
    for (const url of objects) {
      if (signal?.aborted) return
      await this.viewer
        .cancelLoad(url, true)
        .catch((e) => console.warn('Viewer Unload error', url, e))
        .finally(() => {
          if (this.loadedObjectsCache.has(url)) this.loadedObjectsCache.delete(url)
          if (onObjectUnloaded) onObjectUnloaded(url)
        })
    }
  }

  public async loadObjects(
    objectUrls: string[],
    onLoad: (url: string, index: number) => void,
    onError: (url: string, error: Error) => void,
    signal: AbortSignal
  ) {
    console.groupCollapsed('Loading objects')
    try {
      var index = 0
      for (const url of objectUrls) {
        if (signal?.aborted) return
        console.log('Attempting to load', url)
        if (!this.loadedObjectsCache.has(url)) {
          console.log('Object is not in cache')
          var promise = this.viewer
            .loadObjectAsync(url, this.authToken, false)
            .then(() => onLoad(url, index++))
            .catch((e: Error) => onError(url, e))
            .finally(() => {
              if (!this.loadedObjectsCache.has(url)) this.loadedObjectsCache.add(url)
            })
          this.promises.push(promise)
          if (this.promises.length == this.batchSize) {
            //this.promises.push(Promise.resolve(this.later(1000)))
            await Promise.all(this.promises)
            this.promises = []
          }
        } else {
          console.log('Object was already in cache')
        }
      }
      await Promise.all(this.promises).finally(() => (this.promises = []))
    } catch (error) {
      throw new Error(`Load objects failed: ${error}`)
    } finally {
      console.groupEnd()
    }
  }

  private later(delay) {
    return new Promise<void>((resolve) => {
      setTimeout(() => resolve(), delay)
    })
  }

  public async highlightObjects(objectIds: string[]) {
    if (objectIds) {
      await this.viewer.highlightObjects(objectIds, true)
      console.log('highlighted objects', objectIds)
    } else {
      await this.viewer.resetHighlight()
      console.log('reset highlight')
    }
  }
  private keySuffix: number = 0
  public async unIsolateObjects(objectIds: string[]) {
    console.log('UnIsolating objects', 'powerbi' + this.keySuffix, objectIds.length)
    this.state = await this.viewer.unIsolateObjects(objectIds, 'powerbi' + this.keySuffix, true)
  }
  public async isolateObjects(objectIds, ghost: boolean = false) {
    console.log('Isolating objects', 'powerbi' + this.keySuffix, objectIds.length, ghost)
    this.keySuffix++
    this.state = await this.viewer.isolateObjects(
      objectIds,
      'powerbi' + this.keySuffix,
      true,
      ghost
    )
  }

  public async colorObjectsByGroup(
    groups?: {
      objectIds: string[]
      color: string
    }[]
  ) {
    if (!groups) this.state = await this.viewer.removeColorFilter()
    else
      this.state = await this.viewer
        //@ts-ignore
        .setUserObjectColors(groups)
  }

  public async resetFilters(zoomExtents: boolean = false) {
    this.state = await this.viewer.resetFilters()
    if (zoomExtents) this.viewer.zoom()
  }

  public async clear() {
    if (this.viewer) await this.viewer.unloadAll()
  }

  public async selectObjects(objectIds: string[] = null) {
    this.currentSelection.clear()
    objectIds?.forEach((id) => this.currentSelection.add(id))
    this.state = await this.viewer.selectObjects(objectIds ?? [])
  }

  public getScreenPosition(worldPosition): { x: number; y: number } {
    return projectToScreen(this.viewer.cameraHandler.camera, worldPosition)
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
