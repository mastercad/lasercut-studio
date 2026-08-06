import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBoxPanels, defaultBox } from '../model/box'
import { useEditor } from '../store/editor'
import { Properties } from './Properties'

vi.mock('../model/fonts', async (importOriginal) => {
  const original = await importOriginal<typeof import('../model/fonts')>()
  return {
    ...original,
    createBundledTextOutline: vi.fn(async () => ({
      faces: [],
      width: 20,
      height: 10,
    })),
    createSystemTextOutline: vi.fn(async () => ({
      faces: [],
      width: 20,
      height: 10,
    })),
    listInstalledSystemFonts: vi.fn(async () => ['Arial', 'Fira Sans']),
  }
})

const selectFreshShape = (
  type: 'rectangle' | 'triangle' | 'circle' | 'star' | 'polygon' | 'text',
) => {
  useEditor.getState().newProject('empty')
  useEditor.getState().addShape(type)
  return useEditor.getState().panels[0]
}

const geometryInputs = () =>
  Array.from(
    document
      .querySelector<HTMLDetailsElement>('.object-geometry-editor')!
      .querySelectorAll<HTMLInputElement>(
        ':scope > .sidebar-accordion-content > label input',
      ),
  )

beforeEach(() => {
  localStorage.clear()
  useEditor.setState({ rotationPreview: null })
})

afterEach(cleanup)

describe('Properties sidebar object-specific behavior', () => {
  it('keeps the free-socket creation workflow out of the properties sidebar', () => {
    useEditor.getState().newProject('box')
    useEditor.getState().selectPanel('front')
    render(<Properties />)
    expect(
      screen.queryByText('Aufnahmen automatisch verteilen'),
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/Freie Aufnahmen/)).not.toBeInTheDocument()
  })
  it('lists generated cross sockets with the existing panel cut properties', async () => {
    useEditor.getState().newProject('box')
    useEditor.getState().selectPanel('front')
    useEditor.getState().createSocketPattern({
      count: 2,
      span: 30,
      slotLength: 15,
      targetThickness: 3,
      clearance: 0.1,
      socketType: 'cross',
      entrySide: 'positive',
      depthRatio: 0.5,
    })
    render(<Properties />)
    expect(screen.getByText('Aussparungen · 2')).toBeInTheDocument()
    expect(screen.getAllByText(/Kreuzsteckaufnahme/)).toHaveLength(2)
    expect(screen.getAllByText(/Kante A · 50 % Tiefe/)).toHaveLength(2)
    const first = screen
      .getAllByText(/Kreuzsteckaufnahme/)[0]
      .closest('details')!
    expect(
      within(first).getByText('Abstand von linker Kante'),
    ).toBeInTheDocument()
    const firstPosition = first.querySelector('input')!
    expect(Number(firstPosition.value)).toBe(
      useEditor.getState().panels.find((panel) => panel.id === 'front')!
        .size[0] /
        2 -
        15,
    )
    fireEvent.change(firstPosition, { target: { value: '20' } })
    expect(useEditor.getState().socketPatterns[0].instances[0].offset).toBe(
      20 -
        useEditor.getState().panels.find((panel) => panel.id === 'front')!
          .size[0] /
          2 +
        15,
    )
    await userEvent.click(within(first).getByText('Entfernen'))
    expect(
      useEditor.getState().panels.find((panel) => panel.id === 'front')!.cuts,
    ).toHaveLength(1)
    expect(useEditor.getState().socketPatterns[0].instances[0].deleted).toBe(
      true,
    )
  })

  it.each([
    [
      'rectangle',
      [],
      ['Anzahl Seiten', 'Kreisauflösung', 'Sternspitzen', 'Inhalt'],
    ],
    [
      'triangle',
      [],
      ['Anzahl Seiten', 'Kreisauflösung', 'Sternspitzen', 'Inhalt'],
    ],
    ['circle', ['Kreisauflösung'], ['Anzahl Seiten', 'Sternspitzen', 'Inhalt']],
    [
      'star',
      ['Sternspitzen', 'Innenradius'],
      ['Anzahl Seiten', 'Kreisauflösung', 'Inhalt'],
    ],
    [
      'polygon',
      ['Anzahl Seiten'],
      ['Kreisauflösung', 'Sternspitzen', 'Inhalt'],
    ],
  ] as const)(
    'shows only the parameters belonging to a fresh %s',
    (type, visible, hidden) => {
      selectFreshShape(type)
      render(<Properties />)
      for (const label of visible)
        expect(screen.getByText(label)).toBeInTheDocument()
      for (const label of hidden)
        expect(screen.queryByText(label)).not.toBeInTheDocument()
    },
  )

  it('shows text settings only for text and keeps them after another shape was selected before it', async () => {
    selectFreshShape('circle')
    const view = render(<Properties />)
    expect(screen.queryByText('Schriftart')).not.toBeInTheDocument()

    selectFreshShape('text')
    view.rerender(<Properties />)

    expect(screen.getByText('Inhalt')).toBeInTheDocument()
    expect(screen.getByText('Schriftart')).toBeInTheDocument()
    expect(screen.getByText('Schriftgröße')).toBeInTheDocument()
    expect(screen.getByText('Darstellung')).toBeInTheDocument()
    await waitFor(() =>
      expect(useEditor.getState().panels[0].shape?.type).toBe('text'),
    )
  })

  it('updates each parametric shape property through the sidebar without changing its type', () => {
    const cases = [
      ['circle', 'Kreisauflösung', '88', { type: 'circle', segments: 88 }],
      ['polygon', 'Anzahl Seiten', '9', { type: 'polygon', sides: 9 }],
      [
        'star',
        'Sternspitzen',
        '7',
        { type: 'star', points: 7, innerRatio: 0.45 },
      ],
    ] as const

    for (const [type, label, value, expected] of cases) {
      cleanup()
      selectFreshShape(type)
      render(<Properties />)
      fireEvent.change(screen.getByLabelText(label), { target: { value } })
      expect(useEditor.getState().panels[0].shape).toMatchObject(expected)
    }
    cleanup()
    selectFreshShape('star')
    render(<Properties />)
    const innerRadius = screen
      .getByText('Innenradius')
      .closest('label')!
      .querySelector('input')!
    fireEvent.change(innerRadius, {
      target: { value: '95' },
    })
    expect(useEditor.getState().panels[0].shape).toMatchObject({
      type: 'star',
      innerRatio: 0.9,
    })
    fireEvent.change(innerRadius, {
      target: { value: '5' },
    })
    expect(useEditor.getState().panels[0].shape).toMatchObject({
      type: 'star',
      innerRatio: 0.1,
    })
  })

  it('renders live transform preview values and returns to committed values when preview ends', () => {
    const panel = selectFreshShape('rectangle')
    const view = render(<Properties />)
    act(() =>
      useEditor.getState().setRotationPreview({
        panelId: panel.id,
        position: [12.345, -6, 9],
        rotation: [Math.PI / 2, 0, Math.PI],
        size: [123, 45, panel.size[2]],
      }),
    )

    expect(geometryInputs().map((input) => input.value)).toEqual([
      '12.345',
      '-6',
      '9',
      '90',
      '0',
      '180',
      '123',
      '45',
    ])

    act(() => useEditor.getState().setRotationPreview(null))
    view.rerender(<Properties />)
    expect(geometryInputs()[0]).toHaveValue('0')
  })

  it('commits position, size and rotation edits to the selected object', async () => {
    const user = userEvent.setup()
    const panel = selectFreshShape('rectangle')
    render(<Properties />)

    const positionX = geometryInputs()[0]
    await user.clear(positionX)
    await user.type(positionX, '17,5')
    fireEvent.blur(positionX)
    fireEvent.change(geometryInputs()[4], { target: { value: '45' } })
    const width = geometryInputs()[6]
    await user.clear(width)
    await user.type(width, '120')
    fireEvent.blur(width)

    const updated = useEditor
      .getState()
      .panels.find(({ id }) => id === panel.id)!
    expect(updated.position[0]).toBe(17.5)
    expect(updated.rotation[1]).toBeCloseTo(Math.PI / 4)
    expect(updated.size[0]).toBe(120)
  })

  it('edits all text settings and loads, filters, selects and reloads system fonts', async () => {
    const user = userEvent.setup()
    selectFreshShape('text')
    const { container } = render(<Properties />)
    const section = container.querySelector<HTMLElement>(
      '.text-shape-parameters',
    )!
    fireEvent.change(
      within(section)
        .getByText('Inhalt')
        .closest('label')!
        .querySelector('input')!,
      { target: { value: 'Gravurtext' } },
    )
    await waitFor(() =>
      expect(useEditor.getState().panels[0].shape).toMatchObject({
        type: 'text',
        text: 'Gravurtext',
      }),
    )
    fireEvent.change(
      within(section)
        .getByText('Schriftgröße')
        .closest('label')!
        .querySelector('input')!,
      { target: { value: '0' } },
    )
    await waitFor(() =>
      expect(useEditor.getState().panels[0].shape).toMatchObject({
        type: 'text',
        fontSize: 1,
      }),
    )
    fireEvent.change(
      within(section)
        .getByText('Darstellung')
        .closest('label')!
        .querySelector('select')!,
      { target: { value: 'outline' } },
    )
    expect(useEditor.getState().panels[0].shape).toMatchObject({
      type: 'text',
      display: 'outline',
    })

    await user.click(container.querySelector('.font-selection')!)
    await user.click(screen.getByText('Systemschriften laden'))
    await waitFor(() =>
      expect(screen.getByText('2 von 2 Schriftarten')).toBeInTheDocument(),
    )
    fireEvent.change(screen.getByPlaceholderText('Schriftarten filtern…'), {
      target: { value: 'nicht vorhanden' },
    })
    expect(screen.getByText('Keine passende Schriftart.')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Schriftarten filtern…'), {
      target: { value: 'fira' },
    })
    await user.click(screen.getByRole('option', { name: 'Fira Sans' }))
    await waitFor(() =>
      expect(useEditor.getState().panels[0].shape).toMatchObject({
        type: 'text',
        fontFamily: 'Fira Sans',
      }),
    )
    await user.click(container.querySelector('.font-selection')!)
    await user.click(screen.getByText('Systemschriften neu einlesen'))
  })
})

describe('Properties sidebar accordions', () => {
  it('persists every category independently and restores it after remount', async () => {
    const user = userEvent.setup()
    selectFreshShape('text')
    const view = render(<Properties />)
    const geometry = screen.getByText('Geometrie').closest('summary')!
      .parentElement as HTMLDetailsElement
    const text = screen
      .getByText('Text', { selector: 'summary span' })
      .closest('summary')!.parentElement as HTMLDetailsElement

    expect(geometry.open).toBe(true)
    expect(text.open).toBe(true)
    await user.click(within(geometry).getByText('Geometrie'))
    expect(geometry.open).toBe(false)
    expect(text.open).toBe(true)
    expect(
      JSON.parse(
        localStorage.getItem('lasercut-studio.sidebar-accordions.v1')!,
      ),
    ).toMatchObject({
      geometry: false,
    })

    view.unmount()
    render(<Properties />)
    expect(
      screen.getByText('Geometrie').closest('summary')!.parentElement,
    ).not.toHaveAttribute('open')
    expect(
      screen.getByText('Text', { selector: 'summary span' }).closest('summary')!
        .parentElement,
    ).toHaveAttribute('open')
  })

  it('survives malformed persisted state and uses category defaults', () => {
    localStorage.setItem('lasercut-studio.sidebar-accordions.v1', '{invalid')
    selectFreshShape('rectangle')
    render(<Properties />)
    expect(
      screen.getByText('Geometrie').closest('summary')!.parentElement,
    ).toHaveAttribute('open')
    expect(
      screen.getByText('Objektfarbe').closest('summary')!.parentElement,
    ).not.toHaveAttribute('open')
  })
})

describe('Properties selection behavior', () => {
  it('does not render object controls without an object selection', () => {
    useEditor.setState({
      panels: createBoxPanels(defaultBox),
      selectedPanels: [],
    })
    render(<Properties />)
    expect(screen.queryByText('Position')).not.toBeInTheDocument()
    expect(screen.queryByText('Schriftart')).not.toBeInTheDocument()
  })
})
