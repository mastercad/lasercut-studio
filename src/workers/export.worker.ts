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
  jobs: { material: MaterialDefinition; steps: ProjectExportStep[] }[]
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
        .map((material) => ({
          material,
          steps: buildProjectExportSteps(
            material,
            payload.panels,
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
        }))
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
      const svg = createProfiledMaterialSvg(
        material,
        payload.panels.filter((panel) => panel.materialId === material.id),
        payload.panels,
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
        payload.groups,
        cachedContours,
      )
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
