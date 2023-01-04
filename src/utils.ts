import powerbi from "powerbi-visuals-api"

export function VisualUpdateTypeToString(type: powerbi.VisualUpdateType) {
  switch (type) {
    case powerbi.VisualUpdateType.Resize:
      return "Resize"
    case powerbi.VisualUpdateType.ResizeEnd:
      return "ResizeEnd"
    case powerbi.VisualUpdateType.Style:
      return "Style"
    case powerbi.VisualUpdateType.ViewMode:
      return "ViewMode"
    case powerbi.VisualUpdateType.Resize + powerbi.VisualUpdateType.ResizeEnd:
      return "Resize+ResizeEnd"
    case powerbi.VisualUpdateType.Data:
      return "Data"
    case powerbi.VisualUpdateType.All:
      return "All"
  }
}

export function cleanupDataColumnName(name: string) {
  var cleanName = name
  var simplePrefixes = ["First", "Last"]
  var compoundPrefixes = [
    "Count",
    "Sum",
    "Average",
    "Minimum",
    "Maximum",
    "Count",
    "Standard deviation",
    "Variance",
    "Median"
  ].map(prefix => prefix + " of")

  var prefixes = [...simplePrefixes, ...compoundPrefixes].map(
    prefix => prefix + " "
  )

  for (let i = 0; i < prefixes.length; i++) {
    const prefix = prefixes[i]
    if (name.startsWith(prefix)) {
      cleanName = name.slice(prefix.length)
      break
    }
  }

  if (cleanName.startsWith("data.")) cleanName = cleanName.split("data.")[0]
  return cleanName
}

export function projectToScreen(cam: any, loc: any) {
  cam.updateProjectionMatrix()
  var copy = loc.clone()
  copy.project(cam)
  return {
    x: (copy.x * 0.5 + 0.5) * window.innerWidth,
    y: (copy.y * -0.5 + 0.5) * window.innerHeight
  }
}
