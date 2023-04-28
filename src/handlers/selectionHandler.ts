import { SpeckleSelectionData } from '../types'

export default class SelectionHandler {
  private selectionIdMap: Map<string, SpeckleSelectionData>
  private selectionManager: powerbi.extensibility.ISelectionManager
  public PingScreenPosition: (worldPosition) => { x: number; y: number }

  public constructor(manager: powerbi.extensibility.ISelectionManager) {
    this.selectionManager = manager
    this.selectionIdMap = new Map<string, SpeckleSelectionData>()
  }

  public showContextMenu(hit) {
    var loc = this.PingScreenPosition(hit.point)
    var selectionId = this.selectionIdMap.get(hit.guid).id
    this.selectionManager.showContextMenu(selectionId, loc)
  }

  public select(url: string) {
    this.selectionManager.select(this.selectionIdMap.get(url).id, false)
  }

  public clear() {
    this.selectionManager.clear()
  }

  public getData(url: string) {
    this.selectionIdMap.get(url)
  }

  public reset() {
    this.selectionIdMap = new Map<string, SpeckleSelectionData>()
  }

  public has(url) {
    return this.selectionIdMap.has(url)
  }

  public urls() {
    return this.selectionIdMap.keys()
  }
}
