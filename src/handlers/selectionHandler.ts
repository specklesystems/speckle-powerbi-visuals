import { AsyncSignal } from '../utils/signal'
import { SpeckleSelectionData } from '../interfaces'

export default class SelectionHandler {
  private selectionIdMap: Map<string, powerbi.extensibility.ISelectionId>
  private selectionManager: powerbi.extensibility.ISelectionManager
  private host: powerbi.extensibility.visual.IVisualHost

  public PingScreenPosition: (worldPosition) => { x: number; y: number }
  private onSelection = new AsyncSignal<SelectionHandler, powerbi.extensibility.ISelectionId[]>()

  public get OnSelectionEvent() {
    return this.onSelection.expose()
  }

  public constructor(host: powerbi.extensibility.visual.IVisualHost) {
    this.host = host
    this.selectionManager = this.host.createSelectionManager()
    this.selectionIdMap = new Map<string, powerbi.extensibility.ISelectionId>()
    this.selectionManager.registerOnSelectCallback(async (ids) => {
      await this.onSelection.triggerAwait(this, ids)
    })
  }

  public showContextMenu(hit) {
    console.log('showing context menu for hit')
    const loc = this.PingScreenPosition(hit.point)
    const selectionId = this.selectionIdMap.get(hit.object.id)
    this.selectionManager.showContextMenu(selectionId, loc)
  }

  public set(url: string, data: powerbi.extensibility.ISelectionId) {
    this.selectionIdMap.set(url, data)
  }
  public select(url: string, multi = false) {
    this.selectionManager.select(this.selectionIdMap.get(url), multi)
  }

  public clear() {
    this.selectionManager.clear()
  }

  public reset() {
    this.clear()
    this.selectionIdMap = new Map<string, SpeckleSelectionData>()
  }

  public has(url) {
    return this.selectionIdMap.has(url)
  }
}
