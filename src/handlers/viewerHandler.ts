import { CanonicalView, FilteringState, Viewer, IntersectionQuery } from '@speckle/viewer'
import { createViewerContainerDiv, pickViewableHit, projectToScreen } from '../utils/viewerUtils'
import { SpeckleVisualSettings } from '../settings'
import { SettingsChangedType, Tracker } from '../utils/mixpanel'

export default class ViewerHandler {
  private viewer: Viewer
  private readonly parent: HTMLElement
  private state: FilteringState
  private loadedObjectsCache: Set<string> = new Set<string>()
  private settings = {
    authToken: null,
    batchSize: 25
  }

  public OnCameraUpdate: () => void

  public constructor(parent: HTMLElement) {
    this.parent = parent
  }

  private onCameraUpdate(args) {
    if (this.OnCameraUpdate) this.OnCameraUpdate()
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
    const point = this.viewer.Utils.screenToNDC(
      coords.x,
      coords.y,
      this.parent.clientWidth,
      this.parent.clientHeight
    )
    const intQuery: IntersectionQuery = {
      operation: 'Pick',
      point
    }

    const res = this.viewer.query(intQuery)
    console.log('Intersection result', res)
    if (!res) return null
    return {
      hit: pickViewableHit(res.objects, this.state),
      objects: res.objects
    }
  }

  public async unIsolateObjects() {
    console.log('UnIsolating objects', this.state)
    if (this.state.isolatedObjects)
      this.state = await this.viewer.unIsolateObjects(this.state.isolatedObjects, 'powerbi', true)
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

  public async clear() {
    if (this.viewer) await this.viewer.unloadAll()
    this.loadedObjectsCache.clear()
  }

  public async selectObjects(objectIds: string[] = null) {
    await this.viewer.resetHighlight()
    const objIds = objectIds ?? []
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
