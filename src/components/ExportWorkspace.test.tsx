import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEditor } from '../store/editor'
import type { ExportAnalysis } from '../model/exportWorkerClient'

const worker = vi.hoisted(() => ({
  analyze: vi.fn(),
  preview: vi.fn(),
  package: vi.fn(),
}))
vi.mock('../model/exportWorkerClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../model/exportWorkerClient')>()),
  getExportWorkerClient: () => worker,
}))
import { ExportWorkspace } from './ExportWorkspace'

const analysisForState = (configured = true): ExportAnalysis => {
  const state = useEditor.getState()
  const material = state.materials.find(({ id }) => id === 'birch-3')!
  return {
    cache: { hits: 0, misses: 1 },
    jobs: [
      {
        material,
        steps: [
          {
            id: 'profile-step',
            kind: 'profile',
            materialId: material.id,
            profileId: state.processingProfiles[0].id,
            name: 'Gravur',
            mode: 'fill',
            referenceDepth: 0.8,
            color: '#777777',
            contourCount: 1,
            objectIds: ['front'],
            configured,
            speed: 100,
            power: 20,
            passes: 1,
            airAssist: false,
          },
          {
            id: 'outer-step',
            kind: 'cut-outer',
            materialId: material.id,
            name: 'Außenschnitt',
            mode: 'line',
            color: '#d0b000',
            contourCount: 1,
            objectIds: ['front'],
            configured: true,
            speed: 10,
            power: 80,
            passes: 2,
            airAssist: true,
          },
        ],
      },
    ],
  }
}

beforeEach(() => {
  useEditor.getState().newProject('box')
  useEditor.setState({ selectedGroupId: null })
  worker.analyze.mockReset().mockImplementation(async () => analysisForState())
  worker.preview
    .mockReset()
    .mockResolvedValue(
      '<?xml version="1.0"?><svg viewBox="0 0 100 50"><path d="M0 0h10v10z"/></svg>',
    )
  worker.package.mockReset().mockResolvedValue(new ArrayBuffer(4))
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:zip'),
    revokeObjectURL: vi.fn(),
  })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(
    () => undefined,
  )
  Object.defineProperty(SVGSVGElement.prototype, 'viewBox', {
    configurable: true,
    get: () => ({ baseVal: { x: 0, y: 0, width: 100, height: 50 } }),
  })
  Object.defineProperty(SVGSVGElement.prototype, 'getScreenCTM', {
    configurable: true,
    value: () => ({ inverse: () => ({}) }),
  })
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    configurable: true,
    value: vi.fn(),
  })
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
    configurable: true,
    value: vi.fn(),
  })
  vi.stubGlobal(
    'DOMPoint',
    class {
      constructor(
        public x: number,
        public y: number,
      ) {}
      matrixTransform() {
        return this
      }
    },
  )
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('ExportWorkspace', () => {
  it('analyzes visible scoped panels and renders configured job order and values', async () => {
    render(<ExportWorkspace />)
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(await screen.findByText('Gravur')).toBeInTheDocument()
    expect(screen.getByText('Außenschnitt')).toBeInTheDocument()
    expect(screen.getByText('100 mm/min')).toBeInTheDocument()
    expect(screen.getByText('80 %')).toBeInTheDocument()
    expect(screen.getByText('2×')).toBeInTheDocument()
    expect(worker.analyze).toHaveBeenCalled()
  })

  it('changes export scope and excludes hidden groups from worker payload', async () => {
    const { container } = render(<ExportWorkspace />)
    await screen.findByText('Gravur')
    fireEvent.change(container.querySelector('.export-scope select')!, {
      target: { value: 'group-1' },
    })
    await waitFor(() => expect(worker.analyze).toHaveBeenCalledTimes(2))
    const payload = worker.analyze.mock.calls.at(-1)![0]
    expect(payload.panels).toHaveLength(6)
  })

  it('moves multiple processing steps in both directions', async () => {
    worker.analyze.mockImplementation(async () => {
      const analysis = analysisForState()
      const second = useEditor.getState().processingProfiles[1]
      analysis.jobs[0].steps.splice(1, 0, {
        ...analysis.jobs[0].steps[0],
        id: 'profile-step-2',
        profileId: second.id,
        name: second.name,
      })
      return analysis
    })
    const { container } = render(<ExportWorkspace />)
    await screen.findByText('Gravur')
    const firstOrder = useEditor.getState().processingProfiles[0].order
    const secondOrder = useEditor.getState().processingProfiles[1].order
    const enabled = container.querySelectorAll<HTMLButtonElement>(
      '.job-order button:not(:disabled)',
    )
    fireEvent.click(enabled[0])
    expect(useEditor.getState().processingProfiles[1].order).toBe(firstOrder)
    await waitFor(() =>
      expect(worker.analyze.mock.calls.length).toBeGreaterThan(1),
    )
    useEditor
      .getState()
      .moveProcessingProfile(useEditor.getState().processingProfiles[0].id, -1)
    await waitFor(() =>
      expect(useEditor.getState().processingProfiles[0].order).toBe(firstOrder),
    )
    const enabledAfter = container.querySelectorAll<HTMLButtonElement>(
      '.job-order button:not(:disabled)',
    )
    fireEvent.click(enabledAfter[1])
    expect(useEditor.getState().processingProfiles[0].order).toBe(secondOrder)
    expect(useEditor.getState().processingProfiles[1].order).toBe(firstOrder)
  })

  it('shows missing recipe warning and blocks package creation', async () => {
    worker.analyze.mockImplementation(async () => analysisForState(false))
    render(<ExportWorkspace />)
    expect(
      await screen.findByText(/1 Laserzuordnung nachzupflegen/),
    ).toBeInTheDocument()
    const download = screen
      .getByText('Laserzuordnungen nachpflegen')
      .closest('button')!
    expect(download).toBeDisabled()
    expect(download).toHaveAttribute(
      'title',
      '1 Laserzuordnung(en) müssen nachgepflegt werden',
    )
  })

  it('retries a failed analysis and displays package errors', async () => {
    worker.analyze
      .mockRejectedValueOnce(new Error('Analyse fehlgeschlagen'))
      .mockImplementation(async () => analysisForState())
    render(<ExportWorkspace />)
    expect(
      await screen.findByText('Analyse fehlgeschlagen'),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByText('Erneut versuchen'))
    expect(await screen.findByText('Gravur')).toBeInTheDocument()
    worker.package.mockRejectedValueOnce(new Error('ZIP fehlgeschlagen'))
    fireEvent.click(screen.getByText('Exportpaket herunterladen'))
    expect(await screen.findByText('ZIP fehlgeschlagen')).toBeInTheDocument()
  })

  it('downloads the generated ZIP and revokes its URL', async () => {
    vi.useFakeTimers()
    render(<ExportWorkspace />)
    await vi.waitFor(() =>
      expect(screen.getByText('Exportpaket herunterladen')).toBeEnabled(),
    )
    fireEvent.click(screen.getByText('Exportpaket herunterladen'))
    await vi.waitFor(() => expect(worker.package).toHaveBeenCalledOnce())
    expect(URL.createObjectURL).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(1000)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:zip')
    vi.useRealTimers()
  })

  it('opens, switches, zooms, pans, resets and closes SVG preview', async () => {
    useEditor.setState({
      panels: useEditor
        .getState()
        .panels.map((panel) =>
          panel.id === 'back' ? { ...panel, materialId: 'acrylic-3' } : panel,
        ),
    })
    const { container } = render(<ExportWorkspace />)
    await screen.findByText('Gravur')
    fireEvent.click(screen.getByText('Vorschau prüfen'))
    expect(await screen.findByText('Exportvorschau')).toBeInTheDocument()
    await waitFor(() =>
      expect(container.querySelector('.preview-stage svg')).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByText('Acryl · 3 mm'))
    await waitFor(() => expect(worker.preview).toHaveBeenCalledTimes(2))
    const svg = container.querySelector<SVGSVGElement>('.preview-stage svg')!
    fireEvent.click(screen.getByLabelText('Vorschau vergrößern'))
    fireEvent.click(screen.getByLabelText('Vorschau verkleinern'))
    expect(container.querySelector('output')).toHaveValue('100%')
    const canvas = container.querySelector('.preview-canvas')!
    fireEvent.wheel(canvas, { deltaY: -50, clientX: 10, clientY: 10 })
    fireEvent.pointerDown(canvas, {
      button: 0,
      pointerId: 1,
      clientX: 10,
      clientY: 10,
    })
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 20, clientY: 20 })
    fireEvent.pointerUp(canvas, { pointerId: 1 })
    fireEvent.pointerDown(canvas, {
      button: 0,
      pointerId: 2,
      clientX: 10,
      clientY: 10,
    })
    fireEvent.pointerCancel(canvas, { pointerId: 2 })
    fireEvent.pointerDown(container.querySelector('.preview-controls')!)
    fireEvent.click(screen.getByLabelText('Vorschau einpassen'))
    expect(svg.getAttribute('viewBox')).toBe('0 0 100 50')
    fireEvent.mouseDown(container.querySelector('.export-preview-backdrop')!)
    expect(screen.queryByText('Exportvorschau')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Vorschau prüfen'))
    await screen.findByText('Exportvorschau')
    fireEvent.click(
      container.querySelector('.export-preview-dialog header button')!,
    )
    expect(screen.queryByText('Exportvorschau')).not.toBeInTheDocument()
  })

  it('shows preview errors and empty export scopes', async () => {
    worker.preview.mockRejectedValueOnce(new Error('Vorschau kaputt'))
    const view = render(<ExportWorkspace />)
    await screen.findByText('Gravur')
    fireEvent.click(screen.getByText('Vorschau prüfen'))
    expect(await screen.findByText('Vorschau kaputt')).toBeInTheDocument()
    view.unmount()
    useEditor.setState({ panels: [] })
    worker.analyze.mockResolvedValue({
      jobs: [],
      cache: { hits: 0, misses: 0 },
    })
    render(<ExportWorkspace />)
    expect(await screen.findByText('Nichts zu exportieren')).toBeInTheDocument()
  })
})
