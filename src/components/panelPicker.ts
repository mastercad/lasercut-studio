type PanelPickHandler = (panelId: string) => boolean

let activeHandler: PanelPickHandler | null = null

export function beginPanelPick(handler: PanelPickHandler) {
  activeHandler = handler
  document.documentElement.classList.add('panel-pick-active')
  return () => {
    if (activeHandler === handler) activeHandler = null
    if (!activeHandler)
      document.documentElement.classList.remove('panel-pick-active')
  }
}

export function pickPanelFromCanvas(panelId: string) {
  if (!activeHandler) return false
  const handler = activeHandler
  if (!handler(panelId)) return true
  activeHandler = null
  document.documentElement.classList.remove('panel-pick-active')
  return true
}
