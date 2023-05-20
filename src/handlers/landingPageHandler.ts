export default class LandingPageHandler {
  public enabled = false
  public landingPage: Element = null
  public target: HTMLElement

  constructor(target: HTMLElement) {
    this.target = target
    this.landingPage = createLandingPageElement(this.target)
  }

  public show() {
    console.log('Show landing page')
    if (!this.enabled) {
      this.target.appendChild(this.landingPage)
      this.enabled = true
    }
  }

  public hide() {
    console.log('Hide landing page')
    if (this.enabled) {
      this.target.removeChild(this.landingPage)
      this.enabled = false
    }
  }
}

function createLandingPageElement(parent: HTMLElement): Element {
  return null
}
