import { SpeckleDataInput, SpeckleSelectionData } from '../types'

export default class SelectionHandler {
  private selectionIdMap: Map<string, powerbi.extensibility.ISelectionId>
  private selectionManager: powerbi.extensibility.ISelectionManager
  private host: powerbi.extensibility.IVisualHost

  public PingScreenPosition: (worldPosition) => { x: number; y: number }

  public constructor(host: powerbi.extensibility.IVisualHost) {
    this.host = host
    //@ts-ignore
    this.selectionManager = this.host.createSelectionManager()
    this.selectionIdMap = new Map<string, powerbi.extensibility.ISelectionId>()
  }
  public setup(input: SpeckleDataInput) {
    var objectUrls = input.streamUrlColumn.values.map(
      (stream, index) => `${stream}/objects/${input.objectIdColumn.values[index]}`
    )
    // We create selection Ids for all objects, regardless if they're there already.
    for (let i = 0; i < objectUrls.length; i++) {
      var url = objectUrls[i]
      //@ts-ignore
      var selectionBuilder = this.host.createSelectionIdBuilder()
      var selectionId: powerbi.extensibility.ISelectionId = selectionBuilder
        .withCategory(input.objectIdColumn, i)
        .createSelectionId()
      this.selectionIdMap.set(url, selectionId)
    }
  }
  public showContextMenu(hit) {
    var loc = this.PingScreenPosition(hit.point)
    var selectionId = this.selectionIdMap.get(hit.guid)
    this.selectionManager.showContextMenu(selectionId, loc)
  }

  public set(url: string, data: powerbi.extensibility.ISelectionId) {
    this.selectionIdMap.set(url, data)
  }
  public select(url: string) {
    this.selectionManager.select(this.selectionIdMap.get(url), false)
  }

  public clear() {
    this.selectionManager.clear()
  }

  public getData(url: string) {
    return this.selectionIdMap.get(url)
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
