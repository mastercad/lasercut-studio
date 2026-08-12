import { useEffect, useMemo } from 'react'
import {
  getExportWorkerClient,
  type ExportWorkerPayload,
} from '../model/exportWorkerClient'
import { useEditor } from '../store/editor'

type IdleWindow = Window & {
  requestIdleCallback?: (
    callback: () => void,
    options?: { timeout: number },
  ) => number
  cancelIdleCallback?: (handle: number) => void
}

/** Fills the export worker's contour cache after editing has been idle for a
 * moment. All expensive geometry work stays outside the UI thread. */
export function ExportPrewarmer() {
  const workspace = useEditor((state) => state.workspace)
  const panels = useEditor((state) => state.panels)
  const materials = useEditor((state) => state.materials)
  const profiles = useEditor((state) => state.processingProfiles)
  const recipes = useEditor((state) => state.processingRecipes)
  const presets = useEditor((state) => state.laserPresets)
  const lasers = useEditor((state) => state.laserCutters)
  const activeLaserId = useEditor((state) => state.activeLaserId)
  const groups = useEditor((state) => state.groups)

  const payload = useMemo<ExportWorkerPayload | null>(() => {
    const laser = lasers.find((item) => item.id === activeLaserId) ?? lasers[0]
    if (!laser) return null
    const visiblePanels = panels.filter(
      (panel) =>
        panel.visible !== false &&
        !groups.some(
          (group) =>
            group.visible === false && group.panelIds.includes(panel.id),
        ),
    )
    const usedMaterials = materials.filter((material) =>
      visiblePanels.some(
        (panel) => !panel.hidden && panel.materialId === material.id,
      ),
    )
    return {
      materials: usedMaterials,
      panels: visiblePanels,
      profiles,
      recipes,
      presets,
      laser,
      groups,
    }
  }, [
    panels,
    materials,
    profiles,
    recipes,
    presets,
    lasers,
    activeLaserId,
    groups,
  ])

  useEffect(() => {
    if (workspace !== 'model' || !payload || typeof Worker === 'undefined')
      return
    const idleWindow = window as IdleWindow
    let idleHandle: number | undefined
    const delayHandle = window.setTimeout(() => {
      const warm = () => {
        void getExportWorkerClient()
          .analyze(payload)
          .catch(() => undefined)
      }
      if (idleWindow.requestIdleCallback)
        idleHandle = idleWindow.requestIdleCallback(warm, { timeout: 2000 })
      else warm()
    }, 1200)
    return () => {
      window.clearTimeout(delayHandle)
      if (idleHandle !== undefined) idleWindow.cancelIdleCallback?.(idleHandle)
    }
  }, [workspace, payload])

  return null
}
