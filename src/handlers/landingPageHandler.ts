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
  const container = parent.appendChild(document.createElement('div'));
  container.classList.add('speckle-landing')

  const img = document.createElement('div');
  img.classList.add('speckle-logo')
  container.appendChild(img)

  const subtext = document.createElement('p');
  subtext.classList.add('heading')
  subtext.textContent = 'PowerBI 3D Viewer'
  container.appendChild(subtext)

  const tipContainer = document.createElement('div');
  tipContainer.classList.add('tip-container')

  const tip = document.createElement('p');
  tip.textContent = 'Getting started 💡'
  tip.classList.add('tip')
  tipContainer.appendChild(tip)

  const instructions = document.createElement('p');
  instructions.classList.add('instructions')
  instructions.textContent = 'Please connect the Stream ID and Object ID fields.'
  tipContainer.appendChild(instructions)

  const instructions2 = document.createElement('p')
  instructions2.classList.add('instructions')
  instructions2.textContent =
    "Optionally, connect the 'Object Data' field to color the objects by a value"
  tipContainer.appendChild(instructions2)

  const instructions3 = document.createElement('p')
  instructions3.classList.add('instructions')
  instructions3.classList.add('docs')
  instructions3.innerHTML = 'For more info, check our docs page <b>https://speckle.guide</b>'
  tipContainer.appendChild(instructions3)

  container.appendChild(tipContainer)
  return container
}
