import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBoxPanels, defaultBox, defaultMaterials } from '../model/box'
import {
  createDefaultExportLayers,
  createDefaultLaserPresets,
  createDefaultProcessingProfiles,
  createDefaultProcessingRecipes,
  defaultLaserCutters,
} from '../model/export'

const workerScope = {
  onmessage: null as ((event: MessageEvent) => Promise<void>) | null,
  postMessage: vi.fn(),
}
vi.stubGlobal('self', workerScope)

beforeAll(async () => {
  await import('./export.worker')
})

beforeEach(() => workerScope.postMessage.mockClear())

const commonPayload = () => {
  const profiles = createDefaultProcessingProfiles()
  const panels = createBoxPanels(defaultBox)
  return {
    materials: defaultMaterials,
    panels,
    profiles,
    recipes: createDefaultProcessingRecipes(
      profiles,
      defaultLaserCutters,
      defaultMaterials,
    ),
    presets: createDefaultLaserPresets(defaultLaserCutters, defaultMaterials),
    laser: defaultLaserCutters[0],
    groups: [{ id: 'box', name: 'Box', panelIds: panels.map(({ id }) => id) }],
  }
}

const send = async (data: unknown) => {
  await workerScope.onmessage?.({ data } as MessageEvent)
  return workerScope.postMessage.mock.calls.at(-1)
}

describe('export worker', () => {
  it('analyzes only visible material jobs and reuses cached contours', async () => {
    const payload = commonPayload()
    await send({ id: 1, type: 'analyze', payload })
    const first = workerScope.postMessage.mock.calls.at(-1)![0]
    expect(first).toMatchObject({ id: 1, ok: true })
    expect(first.result.jobs).toHaveLength(1)
    expect(first.result.cache.misses).toBeGreaterThan(0)

    await send({ id: 2, type: 'analyze', payload })
    const second = workerScope.postMessage.mock.calls.at(-1)![0]
    expect(second.result.cache.hits).toBeGreaterThan(0)
    expect(second.result.cache.misses).toBe(0)

    const hidden = {
      ...payload,
      panels: payload.panels.map((panel) => ({ ...panel, visible: false })),
    }
    await send({ id: 3, type: 'analyze', payload: hidden })
    expect(workerScope.postMessage.mock.calls.at(-1)![0].result.jobs).toEqual(
      [],
    )
  })

  it('invalidates geometry and transitive boolean dependencies and tolerates cycles', async () => {
    const payload = commonPayload()
    const panels = payload.panels.map((panel) => ({
      ...panel,
      booleanModifiers: [...panel.booleanModifiers],
    }))
    panels[0].booleanModifiers.push({
      id: 'a-to-b',
      toolId: panels[1].id,
      operation: 'subtract',
      enabled: true,
    })
    panels[1].booleanModifiers.push({
      id: 'b-to-a',
      toolId: panels[0].id,
      operation: 'subtract',
      enabled: true,
    })
    await send({ id: 4, type: 'analyze', payload: { ...payload, panels } })
    expect(workerScope.postMessage.mock.calls.at(-1)![0]).toMatchObject({
      id: 4,
      ok: true,
    })
    panels[1] = {
      ...panels[1],
      size: [panels[1].size[0] + 1, panels[1].size[1], panels[1].size[2]],
    }
    await send({ id: 5, type: 'analyze', payload: { ...payload, panels } })
    expect(
      workerScope.postMessage.mock.calls.at(-1)![0].result.cache.misses,
    ).toBeGreaterThan(0)
  })

  it('creates an SVG preview and reports a missing material', async () => {
    const payload = commonPayload()
    await send({
      id: 6,
      type: 'preview',
      payload: { ...payload, materialId: defaultMaterials[0].id },
    })
    const success = workerScope.postMessage.mock.calls.at(-1)![0]
    expect(success).toMatchObject({ id: 6, ok: true })
    expect(success.result).toContain('<svg')
    await send({
      id: 7,
      type: 'preview',
      payload: { ...payload, materialId: 'missing' },
    })
    expect(workerScope.postMessage.mock.calls.at(-1)![0]).toMatchObject({
      id: 7,
      ok: false,
      error: 'Das Material für die Vorschau wurde nicht gefunden.',
    })
  })

  it('creates a transferable ZIP package buffer', async () => {
    const payload = commonPayload()
    await send({
      id: 8,
      type: 'package',
      payload: {
        ...payload,
        layers: createDefaultExportLayers(defaultMaterials),
        laserTexts: [],
      },
    })
    const [message, options] = workerScope.postMessage.mock.calls.at(-1)!
    expect(message).toMatchObject({ id: 8, ok: true })
    expect(message.result).toBeInstanceOf(ArrayBuffer)
    expect(options.transfer).toEqual([message.result])
  })

  it('serializes non-Error failures', async () => {
    await send({ id: 9, type: 'preview', payload: { panels: null } })
    const response = workerScope.postMessage.mock.calls.at(-1)![0]
    expect(response.id).toBe(9)
    expect(response.ok).toBe(false)
    expect(typeof response.error).toBe('string')
  })
})
