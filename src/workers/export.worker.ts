/// <reference lib="webworker" />
import type {
  LaserTextDefinition,
  MaterialDefinition,
  PanelDefinition,
} from '../model/box'
import {
  buildProjectExportSteps,
  createExportPackage,
  createProfiledMaterialSvg,
  extractPanelContours,
  splitPanelsIntoSheets,
  type ExportGroupInfo,
  type ExportLayerDefinition,
  type LaserCutterDefinition,
  type LaserPreset,
  type PanelContours,
  type ProcessingProfile,
  type ProcessingRecipe,
  type ProjectExportStep,
} from '../model/export'

type CommonPayload = {
  materials: MaterialDefinition[]
  panels: PanelDefinition[]
  profiles: ProcessingProfile[]
  recipes: ProcessingRecipe[]
  presets: LaserPreset[]
  laser: LaserCutterDefinition
  groups: ExportGroupInfo[]
}
type AnalyzeRequest = { id: number; type: 'analyze'; payload: CommonPayload }
type PreviewRequest = {
  id: number
  type: 'preview'
  payload: CommonPayload & { materialId: string }
}
type PackageRequest = {
  id: number
  type: 'package'
  payload: CommonPayload & {
    layers: ExportLayerDefinition[]
    laserTexts: LaserTextDefinition[]
  }
}
type WorkerRequest = AnalyzeRequest | PreviewRequest | PackageRequest
type AnalysisResult = {
  jobs: {
    material: MaterialDefinition
    steps: ProjectExportStep[]
    sheetCount: number
  }[]
  cache: { hits: number; misses: number }
}

const contourCache = new Map<
  string,
  { signature: string; contours: PanelContours }
>()
let hits = 0
let misses = 0

function geometrySnapshot(panel: PanelDefinition) {
  return {
    id: panel.id,
    size: panel.size,
    position: panel.position,
    rotation: panel.rotation,
    cuts: panel.cuts,
    booleanModifiers: panel.booleanModifiers,
    jointFeatures: panel.jointFeatures,
    shape: panel.shape,
  }
}

function dependencySignature(
  panel: PanelDefinition,
  panels: PanelDefinition[],
  visited = new Set<string>(),
): unknown {
  if (visited.has(panel.id)) return { id: panel.id, circular: true }
  const next = new Set(visited).add(panel.id)
  const tools = panel.booleanModifiers.map((modifier) => {
    const tool = panels.find((candidate) => candidate.id === modifier.toolId)
    return {
      modifier,
      tool: tool ? dependencySignature(tool, panels, next) : null,
    }
  })
  return { panel: geometrySnapshot(panel), tools }
}

const cachedContours = (panel: PanelDefinition, panels: PanelDefinition[]) => {
  const signature = JSON.stringify(dependencySignature(panel, panels))
  const cached = contourCache.get(panel.id)
  if (cached?.signature === signature) {
    hits++
    return cached.contours
  }
  misses++
  const contours = extractPanelContours(panel, panels)
  contourCache.set(panel.id, { signature, contours })
  return contours
}

function pruneCache(panels: PanelDefinition[]) {
  const live = new Set(panels.map((panel) => panel.id))
  for (const id of contourCache.keys())
    if (!live.has(id)) contourCache.delete(id)
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, type, payload } = event.data
  try {
    pruneCache(payload.panels)
    if (type === 'analyze') {
      const beforeHits = hits,
        beforeMisses = misses
      const jobs = payload.materials
        .filter((material) =>
          payload.panels.some(
            (panel) =>
              !panel.hidden &&
              panel.visible !== false &&
              panel.materialId === material.id,
          ),
        )
        .map((material) => {
          const materialPanels = payload.panels.filter(
            (panel) => panel.materialId === material.id,
          )
          const sheets = splitPanelsIntoSheets(
            materialPanels,
            payload.panels,
            payload.laser.bedWidth ?? 400,
            payload.laser.bedHeight ?? 400,
            cachedContours,
          )
          return {
            material,
            sheetCount: sheets.length,
            steps: buildProjectExportSteps(
              material,
              materialPanels,
              payload.profiles,
              payload.recipes,
              payload.laser.id,
              {
                inner: payload.presets.find(
                  (preset) =>
                    preset.laserId === payload.laser.id &&
                    preset.materialId === material.id &&
                    preset.operation === 'cut-inner',
                ),
                outer: payload.presets.find(
                  (preset) =>
                    preset.laserId === payload.laser.id &&
                    preset.materialId === material.id &&
                    preset.operation === 'cut-outer',
                ),
              },
              cachedContours,
            ),
          }
        })
      const result: AnalysisResult = {
        jobs,
        cache: { hits: hits - beforeHits, misses: misses - beforeMisses },
      }
      self.postMessage({ id, ok: true, result })
      return
    }
    if (type === 'preview') {
      const material = payload.materials.find(
        (candidate) => candidate.id === payload.materialId,
      )
      if (!material)
        throw new Error('Das Material für die Vorschau wurde nicht gefunden.')
      const materialPanels = payload.panels.filter(
        (panel) => panel.materialId === material.id,
      )
      const bedWidth = payload.laser.bedWidth ?? 400
      const bedHeight = payload.laser.bedHeight ?? 400
      const sheets = splitPanelsIntoSheets(
        materialPanels,
        payload.panels,
        bedWidth,
        bedHeight,
        cachedContours,
      )
      const cutPreset = {
        inner: payload.presets.find(
          (preset) =>
            preset.laserId === payload.laser.id &&
            preset.materialId === material.id &&
            preset.operation === 'cut-inner',
        ),
        outer: payload.presets.find(
          (preset) =>
            preset.laserId === payload.laser.id &&
            preset.materialId === material.id &&
            preset.operation === 'cut-outer',
        ),
      }
      const pageGap = 20
      const pages = sheets.map((sheetPanels, index) => {
        const page = createProfiledMaterialSvg(
          material,
          sheetPanels,
          payload.panels,
          payload.profiles,
          payload.recipes,
          payload.laser.id,
          cutPreset,
          payload.groups,
          cachedContours,
          { width: bedWidth, height: bedHeight },
        )
        const content = page
          .replace(/^<\?xml[^>]*>/, '')
          .replace(/^<svg[^>]*>/, '')
          .replace(/<\/svg>$/, '')
        const y = index * (bedHeight + pageGap)
        return `<g data-sheet="${index + 1}" transform="translate(0 ${y})"><rect x="0" y="0" width="${bedWidth}" height="${bedHeight}" fill="white" stroke="#59616c" stroke-width="1"/>${content}</g>`
      })
      const totalHeight =
        sheets.length * bedHeight + (sheets.length - 1) * pageGap
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${bedWidth}mm" height="${totalHeight}mm" viewBox="0 0 ${bedWidth} ${totalHeight}">${pages.join('')}</svg>`
      self.postMessage({ id, ok: true, result: svg })
      return
    }
    const blob = await createExportPackage(
      payload.materials,
      payload.panels,
      payload.layers,
      payload.laser,
      payload.presets,
      payload.groups,
      payload.laserTexts,
      payload.profiles,
      payload.recipes,
      cachedContours,
    )
    const buffer = await blob.arrayBuffer()
    self.postMessage({ id, ok: true, result: buffer }, { transfer: [buffer] })
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export {}
