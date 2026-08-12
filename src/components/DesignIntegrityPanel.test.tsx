import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesignIntegrityFinding } from '../model/designIntegrity'
import { useEditor } from '../store/editor'

const integrity = vi.hoisted(() => ({ analyze: vi.fn() }))
vi.mock('../model/designIntegrity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../model/designIntegrity')>()),
  analyzeDesignIntegrity: integrity.analyze,
}))

import { DesignIntegrityPanel } from './DesignIntegrityPanel'

const finding = (
  severity: DesignIntegrityFinding['severity'],
  overrides: Partial<DesignIntegrityFinding> = {},
): DesignIntegrityFinding => ({
  id: `${severity}-finding`,
  panelId: 'front',
  panelLabel: 'Vorderseite',
  severity,
  title: 'Schmale Stelle',
  detail: 'Nur 2 mm verbleiben.',
  cutIds: ['inspection-cut'],
  ...overrides,
})

beforeEach(() => {
  vi.useFakeTimers()
  useEditor.getState().newProject('box')
  useEditor.setState((state) => ({
    panels: state.panels.map((panel) =>
      panel.id === 'front'
        ? {
            ...panel,
            cuts: [
              ...panel.cuts,
              {
                id: 'inspection-cut',
                kind: 'hole' as const,
                center: [1, 2, 0] as [number, number, number],
                size: [3, 4, 3] as [number, number, number],
              },
            ],
          }
        : panel,
    ),
  }))
  integrity.analyze.mockReset().mockReturnValue([])
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('DesignIntegrityPanel', () => {
  it('stays hidden without relevant findings', () => {
    const view = render(<DesignIntegrityPanel />)
    act(() => vi.advanceTimersByTime(180))
    expect(view.container).toBeEmptyDOMElement()
  })

  it('expands errors and focuses their first matching cut', () => {
    integrity.analyze.mockReturnValue([finding('error')])
    render(<DesignIntegrityPanel />)
    act(() => vi.advanceTimersByTime(180))
    expect(screen.getByText('1 geometrischer Fehler')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    fireEvent.click(screen.getByText(/Vorderseite · Schmale Stelle/))
    expect(useEditor.getState().selectedPanels).toEqual(['front'])
    expect(useEditor.getState().inspectionFocus).toMatchObject({
      sourceId: 'inspection-cut',
      center: [1, 2, 0],
    })
    fireEvent.click(screen.getByRole('button', { expanded: true }))
  })

  it('shows measurement counts and tolerates stale panel and cut references', () => {
    integrity.analyze.mockReturnValue([
      finding('measurement'),
      finding('measurement', {
        id: 'second',
        panelId: 'missing',
        cutIds: [],
      }),
    ])
    render(<DesignIntegrityPanel />)
    act(() => vi.advanceTimersByTime(180))
    expect(
      screen.getByText('2 unterschrittene Mindestmaße'),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    const findingButtons = screen.getAllByText(/Vorderseite · Schmale Stelle/)
    fireEvent.click(findingButtons[0])
    fireEvent.click(findingButtons[1])
  })
})
