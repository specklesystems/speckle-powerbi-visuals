import {
  CanonicalView,
  FilteringState,
  Viewer,
  ViewerEvent,
  SelectionEvent,
  IntersectionQuery,
  IntersectionQueryResult
} from '@speckle/viewer'
import {
  createViewerContainerDiv,
  getFirstViewableHit,
  projectToScreen
} from '../utils/viewerUtils'
import { SpeckleVisualSettings } from '../settings'
import { SettingsChangedType, Tracker } from '../utils/mixpanel'
import { isMultiSelect } from '../utils/isMultiSelect'

export default class ViewerHandler {
  private viewer: Viewer
  private readonly parent: HTMLElement
  private currentSelection: Set<string> = new Set<string>()
  private state: FilteringState
  private loadedObjectsCache: Set<string> = new Set<string>()
  private settings = {
    authToken: null,
    batchSize: 25
  }

  public OnObjectClicked: (hit: any, multi: boolean) => void
  public OnObjectRightClicked: (hit: any, multi: boolean) => void
  public OnObjectDoubleClicked: (hit: any) => void
  public OnCameraUpdate: () => void

  public constructor(parent: HTMLElement) {
    this.parent = parent
  }

  private onCameraUpdate() {
    if (this.OnCameraUpdate) this.OnCameraUpdate()
  }

  private async objectClicked(arg: SelectionEvent) {
    console.log('viewer clicked event', arg)
    const button = arg?.event?.button ?? 0
    const multi = isMultiSelect(arg?.event)
    const hit = getFirstViewableHit(arg, this.state)

    await this.viewer.resetHighlight()

    if (button == 2) {
      if (this.OnObjectRightClicked) this.OnObjectRightClicked(hit, multi)
    } else if (button == 0) {
      if (this.OnObjectClicked) this.OnObjectClicked(hit, multi)

      if (hit && multi) {
        this.currentSelection.add(hit.object.id as string)
      } else if (hit && !multi) {
        this.currentSelection.clear()
        this.currentSelection.add(hit.object.id as string)
      } else if (!multi) {
        this.currentSelection.clear()
      }

      await this.selectObjects([...this.currentSelection.keys()])
    }
  }

  private objectDoubleClicked(arg: SelectionEvent) {
    console.log('Double clicked', arg)
    const hit = getFirstViewableHit(arg, this.state)
    if (this.OnObjectDoubleClicked) this.OnObjectDoubleClicked(hit)
  }

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
    const container = createViewerContainerDiv(this.parent)
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
      let index = 0
      let promises = []
      for (const url of objectUrls) {
        if (signal?.aborted) return
        console.log('Attempting to load', url)
        if (!this.loadedObjectsCache.has(url)) {
          console.log('Object is not in cache')
          const promise = this.viewer
            .loadObjectAsync(url, this.settings.authToken, false)
            .then(() => onLoad(url, index++))
            .catch((e: Error) => onError(url, e))
            .finally(() => {
              if (!this.loadedObjectsCache.has(url)) this.loadedObjectsCache.add(url)
            })
          promises.push(promise)
          if (promises.length == this.settings.batchSize) {
            //this.promises.push(Promise.resolve(this.later(1000)))
            await Promise.all(promises)
            promises = []
          }
        } else {
          console.log('Object was already in cache')
        }
      }
      await Promise.all(promises)
    } catch (error) {
      throw new Error(`Load objects failed: ${error}`)
    } finally {
      console.groupEnd()
    }
  }

  public async intersect(coords: { x: number; y: number }) {
    const intQuery: IntersectionQuery = {
      operation: 'Pick',
      point: {
        x: coords.x,
        y: coords.y,
        z: 0
      }
    }
    const res = (await this.viewer.queryAsync(intQuery)) as IntersectionQueryResult
    return res.objects
  }

  public async highlightObjects(objectIds: string[]) {
    if (objectIds) {
      await this.viewer.highlightObjects(objectIds)
      console.log('highlighted objects', objectIds)
    } else {
      await this.viewer.resetHighlight()
      console.log('reset highlight')
    }
  }

  public async unIsolateObjects(objectIds: string[]) {
    console.log('UnIsolating objects', 'powerbi', objectIds.length)
    this.state = await this.viewer.unIsolateObjects(objectIds, 'powerbi', true)
  }

  public async isolateObjects(objectIds, ghost = false) {
    console.log('Isolating objects', 'powerbi', objectIds.length, ghost)
    this.state = await this.viewer.isolateObjects(objectIds, 'powerbi', true, ghost)
  }

  public async colorObjectsByGroup(
    groups?: {
      objectIds: string[]
      color: string
    }[]
  ) {
    console.log('🖌️ Coloring objects', groups)
    await this.viewer.removeColorFilter()
    if (groups)
    //@ts-ignore
      this.state = await this.viewer.setUserObjectColors(groups)
  }

  public async resetFilters(zoomExtents = false) {
    this.state = await this.viewer.resetFilters()
    if (zoomExtents) this.viewer.zoom()
  }

  public async clear() {
    if (this.viewer) await this.viewer.unloadAll()
  }

  public async selectObjects(objectIds: string[] = null) {
    this.currentSelection.clear()
    const objIds = objectIds ?? []
    objectIds?.forEach((id) => this.currentSelection.add(id))
    this.state = await this.viewer.selectObjects(objIds)
  }

  public getScreenPosition(worldPosition): { x: number; y: number } {
    return projectToScreen(this.viewer.cameraHandler.camera, worldPosition)
  }

  public dispose() {
    this.viewer.cameraHandler.controls.removeAllEventListeners()
    this.viewer.dispose()
  }
}
