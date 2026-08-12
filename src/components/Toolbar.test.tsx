import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEditor } from '../store/editor'
import { Toolbar } from './Toolbar'
import { pickPanelFromCanvas } from './panelPicker'

beforeEach(() => {
  useEditor.getState().newProject('empty')
  useEditor.setState({
    workspace: 'model',
    missingFonts: [],
    transformMode: 'translate',
    geometrySelectionMode: 'object',
    colorMode: 'object',
    snapEnabled: false,
    transformGridEnabled: false,
  })
  useEditor.setState({ isDirty: false })
  vi.stubGlobal('alert', vi.fn())
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:test'),
    revokeObjectURL: vi.fn(),
  })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(
    () => undefined,
  )
})

afterEach(() => {
  cleanup()
  document.querySelector('[data-test-properties-host]')?.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Toolbar', () => {
  it('opens free socket management as a dedicated tool dialog', async () => {
    useEditor.getState().newProject('box')
    useEditor.getState().selectPanel('front')
    const propertiesHost = document.createElement('aside')
    propertiesHost.className = 'properties-panel'
    propertiesHost.dataset.testPropertiesHost = 'true'
    propertiesHost.scrollTop = 120
    document.body.append(propertiesHost)
    render(<Toolbar />)
    const button = screen.getByRole('button', {
      name: 'Freie Aufnahmen verwalten',
    })
    expect(button).toHaveClass('icon-button')
    expect(button.closest('.toolbar-group')).toHaveClass('tools')
    expect(button.querySelector('svg')).toBeInTheDocument()
    expect(button).not.toHaveTextContent('Freie Aufnahmen')
    await userEvent.click(button)
    expect(
      screen.getByText('Freie Aufnahmen', { selector: 'h2' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('dialog').parentElement).toBe(propertiesHost)
    expect(propertiesHost).toHaveClass('socket-wizard-open')
    expect(propertiesHost.scrollTop).toBe(0)
    expect(useEditor.getState().socketPatterns).toHaveLength(0)
    await waitFor(() =>
      expect(useEditor.getState().jointPreview?.[0].cuts).toHaveLength(4),
    )
    const width = useEditor
      .getState()
      .panels.find((panel) => panel.id === 'front')!.size[0]
    expect(screen.queryByText('Verteilspanne · mm')).not.toBeInTheDocument()
    expect(screen.getByText('Erstellen').closest('footer')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Anzahl'), {
      target: { value: '3' },
    })
    await waitFor(() =>
      expect(useEditor.getState().jointPreview?.[0].cuts).toHaveLength(3),
    )
    expect(useEditor.getState().socketPatterns).toHaveLength(0)
    fireEvent.change(screen.getByLabelText('Anzahl'), {
      target: { value: '4' },
    })
    fireEvent.click(screen.getByText('Erstellen'))
    expect(useEditor.getState().socketPatterns).toHaveLength(1)
    expect(useEditor.getState().jointPreview).toBeNull()
    expect(
      useEditor
        .getState()
        .socketPatterns[0].instances.map(
          (instance) => instance.basePosition + width / 2,
        ),
    ).toEqual([width / 5, (width * 2) / 5, (width * 3) / 5, (width * 4) / 5])
    expect(
      screen.getByText('Freie Aufnahmen', { selector: 'h2' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Auf andere Platte übertragen')).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: 'Zielplatte im 3D-Modell auswählen' }),
    )
    act(() => {
      expect(pickPanelFromCanvas('front')).toBe(true)
    })
    expect(
      screen.getByRole('button', { name: 'Zielauswahl abbrechen' }),
    ).toHaveAttribute('aria-pressed', 'true')
    act(() => {
      expect(pickPanelFromCanvas('back')).toBe(true)
    })
    expect(screen.getByLabelText('Zielpanel')).toHaveValue('back')
    await waitFor(() =>
      expect(useEditor.getState().jointPreview?.[0]).toMatchObject({
        panelId: 'back',
      }),
    )
    expect(useEditor.getState().jointPreview?.[0].cuts).toHaveLength(4)
    fireEvent.click(screen.getByText('Verknüpfen'))
    expect(useEditor.getState().socketPatterns).toHaveLength(2)
    expect(useEditor.getState().socketPatterns[1].panelId).toBe('back')
    fireEvent.click(screen.getByRole('button', { name: 'Aufnahmen schließen' }))
    expect(
      screen.queryByText('Freie Aufnahmen', { selector: 'h2' }),
    ).not.toBeInTheDocument()
    expect(propertiesHost).not.toHaveClass('socket-wizard-open')
    expect(propertiesHost.scrollTop).toBe(120)
  }, 10_000)

  it('removes the live socket preview when the dialog is closed', async () => {
    useEditor.getState().newProject('box')
    useEditor.getState().selectPanel('front')
    render(<Toolbar />)
    await userEvent.click(
      screen.getByRole('button', { name: 'Freie Aufnahmen verwalten' }),
    )
    await waitFor(() =>
      expect(useEditor.getState().jointPreview).not.toBeNull(),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Aufnahmen schließen' }))
    await waitFor(() => expect(useEditor.getState().jointPreview).toBeNull())
    expect(useEditor.getState().socketPatterns).toHaveLength(0)
  })

  it('removes a target-panel ghost when transfer is cancelled by closing', async () => {
    useEditor.getState().newProject('box')
    useEditor.getState().selectPanel('front')
    render(<Toolbar />)
    await userEvent.click(
      screen.getByRole('button', { name: 'Freie Aufnahmen verwalten' }),
    )
    fireEvent.click(screen.getByText('Erstellen'))
    fireEvent.click(
      screen.getByRole('button', { name: 'Zielplatte im 3D-Modell auswählen' }),
    )
    act(() => {
      expect(pickPanelFromCanvas('back')).toBe(true)
    })
    await waitFor(() =>
      expect(useEditor.getState().jointPreview?.[0].panelId).toBe('back'),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Aufnahmen schließen' }))
    await waitFor(() => expect(useEditor.getState().jointPreview).toBeNull())
  })

  it('creates every primitive and enables object actions only with a selection', () => {
    render(<Toolbar />)
    const add = screen.getByLabelText('Objekt hinzufügen')
    for (const type of [
      'rectangle',
      'triangle',
      'circle',
      'star',
      'polygon',
      'text',
    ])
      fireEvent.change(add, { target: { value: type } })
    expect(
      useEditor.getState().panels.map((panel) => panel.shape?.type),
    ).toEqual(['rectangle', 'triangle', 'circle', 'star', 'polygon', 'text'])
    expect(screen.getByLabelText('Auswahl duplizieren')).toBeEnabled()
    fireEvent.click(screen.getByLabelText('Auswahl duplizieren'))
    expect(useEditor.getState().panels).toHaveLength(7)
    fireEvent.click(screen.getByLabelText('Auswahl löschen'))
    expect(useEditor.getState().panels).toHaveLength(6)
  })

  it('switches object, face and edge selection without changing the selected object', async () => {
    useEditor.getState().addShape('circle')
    const id = useEditor.getState().selectedPanels[0]
    render(<Toolbar />)
    await userEvent.click(screen.getByText('Fläche'))
    expect(useEditor.getState()).toMatchObject({
      geometrySelectionMode: 'face',
      selectedPanels: [id],
    })
    await userEvent.click(screen.getByText('Kante'))
    expect(useEditor.getState()).toMatchObject({
      geometrySelectionMode: 'edge',
      selectedPanels: [id],
    })
    await userEvent.click(screen.getByText('Objekt'))
    expect(useEditor.getState().geometrySelectionMode).toBe('object')
  })

  it('disables geometry sub-selection unless exactly one model object is selected', () => {
    const view = render(<Toolbar />)
    expect(screen.getByText('Fläche')).toBeDisabled()
    useEditor.getState().addShape('rectangle')
    view.rerender(<Toolbar />)
    expect(screen.getByText('Fläche')).toBeEnabled()
    act(() => useEditor.setState({ workspace: 'unfold' }))
    expect(screen.getByText('Fläche')).toBeDisabled()
  })

  it('controls transforms, snapping, grid, colors and workflow', async () => {
    const user = userEvent.setup()
    render(<Toolbar />)
    await user.click(screen.getByLabelText('Drehen (R)'))
    expect(useEditor.getState().transformMode).toBe('rotate')
    await user.click(screen.getByLabelText('Skalieren (S)'))
    await user.click(screen.getByLabelText('Flächen-Snapping'))
    await user.click(screen.getByLabelText('Transformationsraster'))
    await user.click(screen.getByLabelText('Objektfarben aktiv'))
    expect(useEditor.getState()).toMatchObject({
      transformMode: 'scale',
      snapEnabled: true,
      transformGridEnabled: true,
      colorMode: 'material',
    })
    await user.click(screen.getByText('Weiter zur Fertigung'))
    expect(useEditor.getState().workspace).toBe('unfold')
  })

  it('edits all transform settings and constraints', async () => {
    render(<Toolbar />)
    fireEvent.click(screen.getByLabelText('Raster & Snapping einstellen'))
    fireEvent.click(screen.getByText('XZ'))
    const inputs = screen
      .getByText('Bewegung')
      .closest('section')!
      .querySelectorAll('input')
    fireEvent.change(inputs[0], { target: { value: '2.5' } })
    fireEvent.change(inputs[1], { target: { value: '7.5' } })
    fireEvent.change(inputs[2], { target: { value: '12' } })
    expect(useEditor.getState()).toMatchObject({
      transformConstraint: 'xz',
      translationStep: 2.5,
      rotationStep: 7.5,
      scaleStep: 0.12,
    })
    fireEvent.click(screen.getByText('×'))
    expect(
      screen.queryByText('Globale Editorsteuerung'),
    ).not.toBeInTheDocument()
  })

  it('opens new-project dialog and applies both templates', async () => {
    const user = userEvent.setup()
    render(<Toolbar />)
    await user.click(screen.getByLabelText('Neues Projekt'))
    await user.click(screen.getByText('Standardbox'))
    expect(useEditor.getState().panels).toHaveLength(6)
    await user.click(screen.getByLabelText('Neues Projekt'))
    await user.click(screen.getByText('Leeres Projekt'))
    expect(useEditor.getState().panels).toHaveLength(0)
    await user.click(screen.getByLabelText('Neues Projekt'))
    await user.click(screen.getByText('Abbrechen'))
    expect(screen.queryByText('Standardbox')).not.toBeInTheDocument()
  })

  it('saves by button and Ctrl+S and duplicates by Ctrl+D outside inputs only', () => {
    useEditor.getState().addShape('rectangle')
    render(<Toolbar />)
    fireEvent.click(screen.getByLabelText('Projektdatei speichern'))
    fireEvent.keyDown(window, { key: 's', ctrlKey: true })
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2)
    fireEvent.keyDown(window, { key: 'd', ctrlKey: true })
    expect(useEditor.getState().panels).toHaveLength(2)
    fireEvent.click(screen.getByLabelText('Raster & Snapping einstellen'))
    const input = screen
      .getByText('Bewegung')
      .closest('label')!
      .querySelector('input')!
    fireEvent.keyDown(input, { key: 'd', ctrlKey: true })
    expect(useEditor.getState().panels).toHaveLength(2)
  })

  it('guards imports and browser closing while the project is dirty', async () => {
    useEditor.getState().addShape('rectangle')
    render(<Toolbar />)
    expect(screen.getByText('LaserCut Studio *')).toBeInTheDocument()

    fireEvent.click(
      screen.getByText('SVG/DXF/LightBurn importieren', {
        selector: 'button',
      }),
    )
    expect(screen.getByText('Ungespeicherte Änderungen')).toBeInTheDocument()
    expect(
      screen.queryByText('Vektordatei importieren'),
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Abbrechen'))

    const unload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(unload)
    expect(unload.defaultPrevented).toBe(true)

    fireEvent.click(
      screen.getByText('SVG/DXF/LightBurn importieren', {
        selector: 'button',
      }),
    )
    fireEvent.click(screen.getByText('Projekt speichern'))
    expect(URL.createObjectURL).toHaveBeenCalledOnce()
    expect(useEditor.getState().isDirty).toBe(false)
    expect(screen.getByText('Vektordatei importieren')).toBeInTheDocument()
  })

  it('shows and dismisses missing-font warning', async () => {
    useEditor.setState({ missingFonts: ['Missing Sans'] })
    render(<Toolbar />)
    expect(screen.getByText(/Fehlend: Missing Sans/)).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('Dialog schließen'))
    expect(useEditor.getState().missingFonts).toEqual([])
    act(() => useEditor.setState({ missingFonts: ['Missing Sans'] }))
    await userEvent.click(screen.getByText('Verstanden'))
    expect(useEditor.getState().missingFonts).toEqual([])
  })

  it('opens project files, rejects invalid files and routes SVG files through the import dialog', async () => {
    const { container } = render(<Toolbar />)
    const input = container.querySelector<HTMLInputElement>(
      '.project-file-input',
    )!
    const inputClick = vi.spyOn(input, 'click')
    fireEvent.click(screen.getByLabelText('Projektdatei öffnen'))
    expect(inputClick).toHaveBeenCalledOnce()

    const valid = new File([''], 'project.lcs.json', {
      type: 'application/json',
    })
    Object.defineProperty(valid, 'text', {
      value: vi.fn(async () => useEditor.getState().serializeProject()),
    })
    fireEvent.change(input, { target: { files: [valid] } })
    await waitFor(() => expect(valid.text).toHaveBeenCalledOnce())
    const invalid = new File([''], 'broken.json', { type: 'application/json' })
    Object.defineProperty(invalid, 'text', {
      value: vi.fn(async () => '{broken'),
    })
    fireEvent.change(input, { target: { files: [invalid] } })
    await waitFor(() => expect(window.alert).toHaveBeenCalledOnce())

    const svg = new File(
      [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
      ],
      'shape.svg',
      { type: 'image/svg+xml' },
    )
    Object.defineProperty(svg, 'text', {
      value: vi.fn(
        async () =>
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
      ),
    })
    fireEvent.change(input, { target: { files: [svg] } })
    await waitFor(() =>
      expect(
        screen.getByText('Vektordatei importieren', { selector: 'h2' }),
      ).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByLabelText('Import schließen'))
    fireEvent.click(
      screen.getByText('SVG/DXF/LightBurn importieren', {
        selector: 'button',
      }),
    )
    expect(screen.getByText('Vektordatei importieren')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Abbrechen'))
    fireEvent.click(screen.getByLabelText('Verschieben (G)'))
    expect(useEditor.getState().transformMode).toBe('translate')
  })
})
