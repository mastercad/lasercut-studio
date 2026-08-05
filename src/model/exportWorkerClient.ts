import type {
  LaserTextDefinition,
  MaterialDefinition,
  PanelDefinition,
} from './box'
import type {
  ExportGroupInfo,
  ExportLayerDefinition,
  LaserCutterDefinition,
  LaserPreset,
  ProcessingProfile,
  ProcessingRecipe,
  ProjectExportStep,
} from './export'

export type ExportWorkerPayload = {
  materials: MaterialDefinition[]
  panels: PanelDefinition[]
  profiles: ProcessingProfile[]
  recipes: ProcessingRecipe[]
  presets: LaserPreset[]
  laser: LaserCutterDefinition
  groups: ExportGroupInfo[]
}
export type ExportAnalysis = {
  jobs: { material: MaterialDefinition; steps: ProjectExportStep[] }[]
  cache: { hits: number; misses: number }
}

export class ExportWorkerClient {
  private worker = new Worker(
    new URL('../workers/export.worker.ts', import.meta.url),
    { type: 'module' },
  )
  private nextId = 1
  private pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (reason?: unknown) => void }
  >()

  constructor() {
    this.worker.onmessage = (
      event: MessageEvent<{
        id: number
        ok: boolean
        result?: unknown
        error?: string
      }>,
    ) => {
      const request = this.pending.get(event.data.id)
      if (!request) return
      this.pending.delete(event.data.id)
      event.data.ok
        ? request.resolve(event.data.result)
        : request.reject(
            new Error(event.data.error ?? 'Unbekannter Exportfehler'),
          )
    }
    this.worker.onerror = (event) => {
      const error = new Error(
        event.message || 'Export-Worker konnte nicht ausgeführt werden.',
      )
      for (const request of this.pending.values()) request.reject(error)
      this.pending.clear()
    }
  }

  private request<T>(
    type: 'analyze' | 'preview' | 'package',
    payload: unknown,
  ): Promise<T> {
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      })
      this.worker.postMessage({ id, type, payload })
    })
  }

  analyze(payload: ExportWorkerPayload) {
    return this.request<ExportAnalysis>('analyze', payload)
  }
  preview(payload: ExportWorkerPayload, materialId: string) {
    return this.request<string>('preview', { ...payload, materialId })
  }
  package(
    payload: ExportWorkerPayload,
    layers: ExportLayerDefinition[],
    laserTexts: LaserTextDefinition[],
  ) {
    return this.request<ArrayBuffer>('package', {
      ...payload,
      layers,
      laserTexts,
    })
  }
  dispose() {
    this.worker.terminate()
    const error = new Error('Exportberechnung wurde beendet.')
    for (const request of this.pending.values()) request.reject(error)
    this.pending.clear()
  }
}

let sharedClient: ExportWorkerClient | null = null
export const getExportWorkerClient = () =>
  (sharedClient ??= new ExportWorkerClient())
