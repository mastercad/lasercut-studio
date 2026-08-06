import { beforeEach, describe, expect, it, vi } from 'vitest'

class WorkerMock {
  static instances: WorkerMock[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  postMessage = vi.fn()
  terminate = vi.fn()
  constructor() {
    WorkerMock.instances.push(this)
  }
}

vi.stubGlobal('Worker', WorkerMock)

describe('ExportWorkerClient', () => {
  beforeEach(() => {
    WorkerMock.instances.length = 0
    vi.resetModules()
  })

  it('routes analyze, preview and package requests and resolves matching responses', async () => {
    const { ExportWorkerClient } = await import('./exportWorkerClient')
    const client = new ExportWorkerClient()
    const worker = WorkerMock.instances[0]
    const payload = {
      materials: [],
      panels: [],
      profiles: [],
      recipes: [],
      presets: [],
      laser: { id: 'laser' },
      groups: [],
    }
    const analyze = client.analyze(payload as never)
    const preview = client.preview(payload as never, 'birch')
    const packageResult = client.package(payload as never, [], [])
    expect(worker.postMessage.mock.calls).toEqual([
      [{ id: 1, type: 'analyze', payload }],
      [
        {
          id: 2,
          type: 'preview',
          payload: { ...payload, materialId: 'birch' },
        },
      ],
      [
        {
          id: 3,
          type: 'package',
          payload: { ...payload, layers: [], laserTexts: [] },
        },
      ],
    ])
    worker.onmessage?.({
      data: {
        id: 1,
        ok: true,
        result: { jobs: [], cache: { hits: 0, misses: 0 } },
      },
    } as MessageEvent)
    worker.onmessage?.({
      data: { id: 2, ok: true, result: '<svg />' },
    } as MessageEvent)
    const buffer = new ArrayBuffer(2)
    worker.onmessage?.({
      data: { id: 3, ok: true, result: buffer },
    } as MessageEvent)
    expect(await analyze).toEqual({ jobs: [], cache: { hits: 0, misses: 0 } })
    expect(await preview).toBe('<svg />')
    expect(await packageResult).toBe(buffer)
  })

  it('rejects worker responses with explicit and fallback errors and ignores unknown ids', async () => {
    const { ExportWorkerClient } = await import('./exportWorkerClient')
    const client = new ExportWorkerClient()
    const worker = WorkerMock.instances[0]
    const payload = {} as never
    const explicit = client.analyze(payload)
    worker.onmessage?.({ data: { id: 99, ok: true } } as MessageEvent)
    worker.onmessage?.({
      data: { id: 1, ok: false, error: 'Kaputt' },
    } as MessageEvent)
    await expect(explicit).rejects.toThrow('Kaputt')
    const fallback = client.analyze(payload)
    worker.onmessage?.({ data: { id: 2, ok: false } } as MessageEvent)
    await expect(fallback).rejects.toThrow('Unbekannter Exportfehler')
  })

  it('rejects every pending request on worker failure', async () => {
    const { ExportWorkerClient } = await import('./exportWorkerClient')
    const client = new ExportWorkerClient()
    const worker = WorkerMock.instances[0]
    const first = client.analyze({} as never)
    const second = client.preview({} as never, 'x')
    worker.onerror?.({ message: 'Worker abgestürzt' } as ErrorEvent)
    await expect(first).rejects.toThrow('Worker abgestürzt')
    await expect(second).rejects.toThrow('Worker abgestürzt')
  })

  it('terminates and rejects pending requests on dispose', async () => {
    const { ExportWorkerClient } = await import('./exportWorkerClient')
    const client = new ExportWorkerClient()
    const worker = WorkerMock.instances[0]
    const pending = client.analyze({} as never)
    client.dispose()
    expect(worker.terminate).toHaveBeenCalledOnce()
    await expect(pending).rejects.toThrow('Exportberechnung wurde beendet')
  })

  it('returns one shared client instance', async () => {
    const { getExportWorkerClient } = await import('./exportWorkerClient')
    expect(getExportWorkerClient()).toBe(getExportWorkerClient())
    expect(WorkerMock.instances).toHaveLength(1)
  })
})
