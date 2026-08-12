import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEditor } from '../store/editor'

const worker = vi.hoisted(() => ({ analyze: vi.fn() }))
vi.mock('../model/exportWorkerClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../model/exportWorkerClient')>()),
  getExportWorkerClient: () => worker,
}))

import { ExportPrewarmer } from './ExportPrewarmer'

beforeEach(() => {
  vi.useFakeTimers()
  useEditor.getState().newProject('box')
  worker.analyze.mockReset().mockResolvedValue(undefined)
  vi.stubGlobal('Worker', class {})
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('ExportPrewarmer', () => {
  it('warms visible model geometry after the delay', async () => {
    useEditor.setState((state) => ({
      groups: [
        {
          id: 'hidden-group',
          name: 'Hidden',
          panelIds: [state.panels[1].id],
          visible: false,
        },
      ],
    }))
    render(<ExportPrewarmer />)
    await vi.advanceTimersByTimeAsync(1200)
    expect(worker.analyze).toHaveBeenCalledTimes(1)
    const payload = worker.analyze.mock.calls[0][0]
    expect(payload.panels).not.toContainEqual(
      expect.objectContaining({ id: useEditor.getState().panels[1].id }),
    )
    expect(
      payload.materials.every((material: { id: string }) =>
        payload.panels.some(
          (panel: { materialId?: string; hidden?: boolean }) =>
            !panel.hidden && panel.materialId === material.id,
        ),
      ),
    ).toBe(true)
  })

  it('uses and cancels idle callbacks', async () => {
    const requestIdleCallback = vi.fn((callback: () => void) => {
      callback()
      return 7
    })
    const cancelIdleCallback = vi.fn()
    Object.assign(window, { requestIdleCallback, cancelIdleCallback })
    const view = render(<ExportPrewarmer />)
    await vi.advanceTimersByTimeAsync(1200)
    expect(requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), {
      timeout: 2000,
    })
    view.unmount()
    expect(cancelIdleCallback).toHaveBeenCalledWith(7)
    ;(
      window as unknown as { requestIdleCallback?: unknown }
    ).requestIdleCallback = undefined
    ;(
      window as unknown as { cancelIdleCallback?: unknown }
    ).cancelIdleCallback = undefined
  })

  it('skips unavailable contexts and absorbs worker failures', async () => {
    useEditor.setState({ workspace: 'unfold' })
    const view = render(<ExportPrewarmer />)
    await vi.advanceTimersByTimeAsync(1200)
    expect(worker.analyze).not.toHaveBeenCalled()

    useEditor.setState({ workspace: 'model', laserCutters: [] })
    view.rerender(<ExportPrewarmer />)
    await vi.advanceTimersByTimeAsync(1200)
    expect(worker.analyze).not.toHaveBeenCalled()

    useEditor.setState({
      laserCutters: useEditor.getInitialState().laserCutters,
    })
    worker.analyze.mockRejectedValueOnce(new Error('warm failed'))
    view.rerender(<ExportPrewarmer />)
    await vi.advanceTimersByTimeAsync(1200)
    expect(worker.analyze).toHaveBeenCalledTimes(1)
  })
})
