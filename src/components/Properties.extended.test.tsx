import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createBoxPanels, defaultBox, defaultMaterials } from '../model/box'
import { createDefaultProcessingProfiles } from '../model/export'
import { useEditor } from '../store/editor'
import { Properties } from './Properties'

beforeEach(() => {
  localStorage.clear()
  const panels = createBoxPanels(defaultBox)
  useEditor.setState({
    box: defaultBox,
    panels,
    materials: defaultMaterials,
    groups: [
      {
        id: 'group-1',
        name: 'Box',
        panelIds: panels.map(({ id }) => id),
        visible: true,
      },
    ],
    selectedPanels: [],
    selectedGroupId: null,
    fingerJoints: [],
    crossJoints: [],
    processingProfiles: createDefaultProcessingProfiles(),
    rotationPreview: null,
    inspectionFocus: null,
  })
})
afterEach(cleanup)

const select = (...ids: string[]) =>
  act(() => useEditor.setState({ selectedPanels: ids, selectedGroupId: null }))

describe('Properties complete category interactions', () => {
  it('edits every box dimension with minimum clamping', () => {
    render(<Properties />)
    for (const [label, value, expected] of [
      ['Breite', '10', 20],
      ['Höhe', '150', 150],
      ['Tiefe', '160', 160],
      ['Fingerbreite', '1', 2],
    ] as const) {
      fireEvent.change(
        screen.getByText(label).closest('label')!.querySelector('input')!,
        { target: { value } },
      )
      const key = {
        Breite: 'width',
        Höhe: 'height',
        Tiefe: 'depth',
        Fingerbreite: 'fingerWidth',
      }[label] as keyof typeof defaultBox
      expect(useEditor.getState().box[key]).toBe(expected)
    }
  })

  it('assigns, edits and creates materials with clamped physical values', async () => {
    select('front')
    const user = userEvent.setup()
    const { container } = render(<Properties />)
    const materialSection =
      container.querySelector<HTMLElement>('.material-editor')!
    fireEvent.change(
      within(materialSection)
        .getByText('Material der Auswahl')
        .closest('label')!
        .querySelector('select')!,
      { target: { value: 'acrylic-3' } },
    )
    expect(
      useEditor.getState().panels.find(({ id }) => id === 'front')?.materialId,
    ).toBe('acrylic-3')
    await user.click(
      within(materialSection).getByText('Materialbibliothek bearbeiten'),
    )
    const library =
      materialSection.querySelector<HTMLElement>('.material-library')!
    fireEvent.change(
      within(library)
        .getByText('Eintrag')
        .closest('label')!
        .querySelector('select')!,
      { target: { value: 'birch-5' } },
    )
    const name = within(library)
      .getByText('Name')
      .closest('label')!
      .querySelector('input')!
    fireEvent.change(name, { target: { value: '' } })
    fireEvent.change(
      within(library)
        .getByText('Materialstärke')
        .closest('label')!
        .querySelector('input')!,
      { target: { value: '0' } },
    )
    fireEvent.change(
      within(library)
        .getByText('Schnittfuge')
        .closest('label')!
        .querySelector('input')!,
      { target: { value: '-1' } },
    )
    fireEvent.change(
      within(library)
        .getByText('Farbe')
        .closest('label')!
        .querySelector('input')!,
      { target: { value: '#112233' } },
    )
    fireEvent.click(within(library).getByText('Änderungen speichern'))
    expect(
      useEditor.getState().materials.find(({ id }) => id === 'birch-5'),
    ).toMatchObject({
      name: 'Material',
      thickness: 0.1,
      kerf: 0,
      color: '#112233',
    })
    fireEvent.click(within(library).getByText('Als neues Material'))
    expect(useEditor.getState().materials.at(-1)).toMatchObject({
      name: 'Material',
      thickness: 0.1,
      kerf: 0,
    })
  })

  it('sets, reuses and clears object colors including group colors', () => {
    select('front')
    const view = render(<Properties />)
    const colorInput = view.container.querySelector<HTMLInputElement>(
      '.object-color-editor input[type="color"]',
    )!
    fireEvent.change(colorInput, { target: { value: '#abcdef' } })
    expect(
      useEditor.getState().panels.find(({ id }) => id === 'front')
        ?.displayColor,
    ).toBe('#abcdef')
    fireEvent.click(screen.getByLabelText('#abcdef übernehmen'))
    fireEvent.click(screen.getByText('Materialfarbe verwenden'))
    expect(
      useEditor.getState().panels.find(({ id }) => id === 'front')
        ?.displayColor,
    ).toBeUndefined()
    act(() =>
      useEditor.setState({
        selectedGroupId: 'group-1',
        selectedPanels: useEditor.getState().groups[0].panelIds,
      }),
    )
    fireEvent.change(
      view.container.querySelector<HTMLInputElement>(
        '.object-color-editor input[type="color"]',
      )!,
      { target: { value: '#123456' } },
    )
    expect(useEditor.getState().groups[0].displayColor).toBe('#123456')
  })

  it('applies, changes, selects the tool of and removes boolean modifiers', () => {
    select('front', 'back')
    const { container } = render(<Properties />)
    fireEvent.click(screen.getByTitle('Ziel und Werkzeug vertauschen'))
    expect(useEditor.getState().selectedPanels).toEqual(['back', 'front'])
    fireEvent.change(container.querySelector('.boolean-operation select')!, {
      target: { value: 'union' },
    })
    fireEvent.click(screen.getByText('Anwenden'))
    const target = useEditor.getState().panels.find(({ id }) => id === 'back')!
    expect(target.booleanModifiers[0]).toMatchObject({
      toolId: 'front',
      operation: 'union',
    })
    select('back')
    const modifier = container.querySelector<HTMLElement>('.modifier-card')!
    fireEvent.change(modifier.querySelector('select')!, {
      target: { value: 'xor' },
    })
    expect(
      useEditor.getState().panels.find(({ id }) => id === 'back')
        ?.booleanModifiers[0].operation,
    ).toBe('xor')
    fireEvent.click(within(modifier).getByText('Werkzeug bearbeiten'))
    expect(useEditor.getState().selectedPanels).toEqual(['front'])
    select('back')
    fireEvent.click(
      within(container.querySelector<HTMLElement>('.modifier-card')!).getByText(
        'Entfernen',
      ),
    )
    expect(
      useEditor.getState().panels.find(({ id }) => id === 'back')
        ?.booleanModifiers,
    ).toEqual([])
  })

  it('edits and removes rectangular cuts', () => {
    const panels = useEditor.getState().panels.map((panel) =>
      panel.id === 'front'
        ? {
            ...panel,
            cuts: [
              {
                id: 'cut-test',
                kind: 'hole' as const,
                center: [0, 0, 0] as [number, number, number],
                size: [10, 20, 3] as [number, number, number],
              },
            ],
          }
        : panel,
    )
    act(() => useEditor.setState({ panels, selectedPanels: ['front'] }))
    const { container } = render(<Properties />)
    const cut = container.querySelector<HTMLElement>('.cut-list details')!
    const inputs = cut.querySelectorAll<HTMLInputElement>('input')
    fireEvent.change(inputs[0], { target: { value: '5' } })
    fireEvent.change(inputs[4], { target: { value: '25' } })
    expect(
      useEditor.getState().panels.find(({ id }) => id === 'front')?.cuts[0],
    ).toMatchObject({ center: [5, 0, 0], size: [10, 25, 3] })
    fireEvent.click(within(cut).getByText('Entfernen'))
    expect(
      useEditor.getState().panels.find(({ id }) => id === 'front')?.cuts,
    ).toEqual([])
  })

  it('focuses cuts and complete connections without coupling remove actions', () => {
    const panels = useEditor.getState().panels.map((panel) =>
      panel.id === 'front'
        ? {
            ...panel,
            cuts: [
              {
                id: 'manual-cut',
                kind: 'hole' as const,
                center: [10, 20, 0] as [number, number, number],
                size: [5, 12, 3] as [number, number, number],
              },
              {
                id: 'joint-cut',
                jointId: 'cross-focus',
                kind: 'half-lap' as const,
                center: [-15, 10, 0] as [number, number, number],
                size: [5, 20, 3] as [number, number, number],
              },
            ],
          }
        : panel,
    )
    act(() =>
      useEditor.setState({
        panels,
        selectedPanels: ['front'],
        crossJoints: [
          {
            id: 'cross-focus',
            firstPanelId: 'front',
            secondPanelId: 'left',
            ratio: 0.5,
            fit: 'tight',
            clearance: 0,
          },
        ],
      }),
    )
    const { container } = render(<Properties />)

    fireEvent.click(within(container).getByText('Rechteckiger Durchbruch 1'))
    expect(useEditor.getState().inspectionFocus).toMatchObject({
      sourceId: 'manual-cut',
      panelId: 'front',
      center: [10, 20, 0],
      size: [5, 12, 3],
    })
    fireEvent.click(within(container).getByText('Rechteckiger Durchbruch 1'))
    expect(useEditor.getState().inspectionFocus).toBeNull()

    fireEvent.click(within(container).getByText('Steckkreuz'))
    expect(useEditor.getState().inspectionFocus).toMatchObject({
      sourceId: 'cross-focus',
      panelId: 'front',
      center: [-15, 10, 0],
      size: [5, 20, 3],
    })
    fireEvent.click(within(container).getByText('Steckkreuz'))
    expect(useEditor.getState().inspectionFocus).toBeNull()
    fireEvent.click(within(container).getByText('Steckkreuz'))

    const connection = container.querySelector<HTMLElement>('.joint-card')!
    fireEvent.click(within(connection).getByText('Entfernen'))
    expect(useEditor.getState().crossJoints).toEqual([])
    expect(useEditor.getState().inspectionFocus).toBeNull()
  })

  it('keeps an external corner strip while clipping only its thickness', () => {
    const panels = useEditor.getState().panels.map((panel) =>
      panel.id === 'front'
        ? {
            ...panel,
            size: [420, 100, 5] as [number, number, number],
            jointFeatures: [
              {
                id: 'first-tab',
                jointId: 'external-corner',
                operation: 'add' as const,
                shape: 'box' as const,
                center: [204, -52.5, 0] as [number, number, number],
                size: [11.98, 5, 5] as [number, number, number],
              },
              {
                id: 'oversized-slot',
                jointId: 'external-corner',
                operation: 'subtract' as const,
                shape: 'box' as const,
                center: [0, -52.5, 0] as [number, number, number],
                size: [12, 5, 7] as [number, number, number],
              },
              {
                id: 'last-tab',
                jointId: 'external-corner',
                operation: 'add' as const,
                shape: 'box' as const,
                center: [-204, -52.5, 0] as [number, number, number],
                size: [11.98, 5, 5] as [number, number, number],
              },
            ],
          }
        : panel,
    )
    act(() =>
      useEditor.setState({
        panels,
        selectedPanels: ['front'],
        fingerJoints: [
          {
            id: 'external-corner',
            firstPanelId: 'front',
            secondPanelId: 'left',
            connectionType: 'corner',
            fingerWidth: 12,
            fit: 'tight',
            clearance: 0,
            style: 'straight',
            reliefDiameter: 1,
          },
        ],
      }),
    )
    const { container } = render(<Properties />)

    fireEvent.click(within(container).getByText('Eckverbindung'))

    expect(useEditor.getState().inspectionFocus).toMatchObject({
      sourceId: 'external-corner',
      panelId: 'front',
      center: [0, -52.5, 0],
      size: [419.98, 5, 5],
    })
  })

  it('clips oversized boolean cutters to the visible panel opening', () => {
    const panels = useEditor.getState().panels.map((panel) =>
      panel.id === 'front'
        ? {
            ...panel,
            size: [80, 100, 5] as [number, number, number],
            cuts: [
              {
                id: 'oversized-half-lap',
                jointId: 'cross-joint',
                kind: 'half-lap' as const,
                center: [0, 25.5, 0] as [number, number, number],
                size: [5, 51, 7] as [number, number, number],
              },
            ],
          }
        : panel,
    )
    act(() => useEditor.setState({ panels, selectedPanels: ['front'] }))
    const { container } = render(<Properties />)

    fireEvent.click(within(container).getByText('50/50-Steckschlitz 1'))
    expect(useEditor.getState().inspectionFocus).toMatchObject({
      center: [0, 25, 0],
      size: [5, 50, 5],
    })
  })

  it('toggles automatic cutting and adds, removes and manages processing profiles', async () => {
    select('front')
    const user = userEvent.setup()
    const { container } = render(<Properties />)
    const processing =
      container.querySelector<HTMLElement>('.processing-editor')!
    const autoCut = within(processing)
      .getByText('Automatische Schnittkonturen')
      .closest('label')!
      .querySelector('input')!
    fireEvent.click(autoCut)
    expect(
      useEditor.getState().panels.find(({ id }) => id === 'front')?.autoCut,
    ).toBe(false)
    expect(
      screen.getByText(/nicht automatisch ausgeschnitten/),
    ).toBeInTheDocument()
    const profile = useEditor.getState().processingProfiles[0]
    fireEvent.change(
      within(processing)
        .getByText('Bearbeitungsprofil hinzufügen')
        .closest('label')!
        .querySelector('select')!,
      { target: { value: profile.id } },
    )
    expect(
      useEditor.getState().panels.find(({ id }) => id === 'front')
        ?.processingAssignments,
    ).toHaveLength(1)
    fireEvent.click(within(processing).getByText('Entfernen'))
    expect(
      useEditor.getState().panels.find(({ id }) => id === 'front')
        ?.processingAssignments,
    ).toEqual([])
    await user.click(
      within(processing).getByText('Bearbeitungsprofile verwalten'),
    )
    expect(
      screen.getByRole('dialog', { name: 'Bearbeitungsprofile' }),
    ).toBeInTheDocument()
    await user.click(screen.getByText('Fertig'))
    expect(
      screen.queryByRole('dialog', { name: 'Bearbeitungsprofile' }),
    ).not.toBeInTheDocument()
  })

  it('moves multi-selection bounds and removes the selection through sidebar actions', () => {
    select('front', 'back')
    const { container } = render(<Properties />)
    const transform = container.querySelector<HTMLElement>(
      '.selection-transform',
    )!
    const inputs = transform.querySelectorAll<HTMLInputElement>('input')
    fireEvent.change(inputs[0], { target: { value: '25' } })
    fireEvent.blur(inputs[0])
    fireEvent.change(inputs[inputs.length - 1], { target: { value: '70' } })
    expect(
      useEditor
        .getState()
        .panels.filter(({ id }) => ['front', 'back'].includes(id))
        .some((panel) => panel.position[0] !== 0),
    ).toBe(true)
    fireEvent.click(screen.getByText('Auswahl aufheben'))
    expect(useEditor.getState().selectedPanels).toEqual([])
    select('front')
    fireEvent.click(screen.getByText('Ausgewählte Teile löschen'))
    expect(useEditor.getState().panels.some(({ id }) => id === 'front')).toBe(
      false,
    )
  })

  it('configures, previews, creates and removes finger connections', () => {
    select('front', 'left')
    const { container } = render(<Properties />)
    const builder = container.querySelector<HTMLElement>('.connection-builder')!
    expect(builder).not.toBeNull()
    expect(
      within(builder).getByText(
        'Wähle die Verbindungsart und prüfe die Vorschau direkt am Modell.',
      ),
    ).toBeVisible()
    fireEvent.change(
      within(builder)
        .getByText('Fingerbreite')
        .closest('label')!
        .querySelector('input')!,
      { target: { value: '1' } },
    )
    fireEvent.change(
      within(builder)
        .getByText('Passung')
        .closest('label')!
        .querySelector('select')!,
      { target: { value: 'custom' } },
    )
    fireEvent.change(
      within(builder)
        .getByText('Spiel')
        .closest('label')!
        .querySelector('input')!,
      { target: { value: '0.35' } },
    )
    fireEvent.change(
      within(builder)
        .getByText('Ecken')
        .closest('label')!
        .querySelector('select')!,
      { target: { value: 'dogbone' } },
    )
    fireEvent.change(
      within(builder)
        .getByText('Bohrungs-Ø')
        .closest('label')!
        .querySelector('input')!,
      { target: { value: '0.1' } },
    )
    fireEvent.click(within(builder).getByText('Verbindung jetzt erstellen'))
    expect(useEditor.getState().fingerJoints[0]).toMatchObject({
      connectionType: 'corner',
      fingerWidth: 2,
      fit: 'custom',
      clearance: 0.35,
      style: 'dogbone',
      reliefDiameter: 0.2,
    })
    select('front')
    const stack = container.querySelector<HTMLElement>('.joint-stack')!
    expect(within(stack).getByText('Eckverbindung')).toBeInTheDocument()
    fireEvent.click(within(stack).getByText('Entfernen'))
    expect(useEditor.getState().fingerJoints).toEqual([])
  })

  it('configures crossing plates including direction, ratio and removal', () => {
    act(() =>
      useEditor.setState({
        panels: useEditor
          .getState()
          .panels.map((panel) =>
            panel.id === 'front' || panel.id === 'left'
              ? { ...panel, position: [0, 0, 0] as [number, number, number] }
              : panel,
          ),
        selectedPanels: ['front', 'left'],
      }),
    )
    const { container } = render(<Properties />)
    const builder = container.querySelector<HTMLElement>('.connection-builder')!
    const type = within(builder)
      .getByText('Verbindungsart')
      .closest('label')!
      .querySelector('select')!
    expect(
      type.querySelector<HTMLOptionElement>('option[value="cross"]')!.disabled,
    ).toBe(false)
    fireEvent.change(type, { target: { value: 'cross' } })
    fireEvent.change(
      within(builder)
        .getByText('Schlitztiefe Teil 1')
        .closest('label')!
        .querySelector('input')!,
      { target: { value: '95' } },
    )
    fireEvent.click(within(builder).getByTitle('Öffnungsrichtung wechseln'))
    expect(
      within(builder).getByText(/Teil 1: 90% von unten/),
    ).toBeInTheDocument()
    fireEvent.click(within(builder).getByText('Verbindung jetzt erstellen'))
    expect(useEditor.getState().crossJoints[0]).toMatchObject({
      ratio: 0.9,
      firstFromHigh: false,
    })
    select('front')
    const stack = container.querySelector<HTMLElement>('.joint-stack')!
    expect(within(stack).getByText('Steckkreuz')).toBeInTheDocument()
    fireEvent.click(within(stack).getByText('Entfernen'))
    expect(useEditor.getState().crossJoints).toEqual([])
  })

  it('shows face and edge editing only in the matching modes and moves the selected contour', () => {
    select('front')
    act(() => {
      useEditor.getState().setGeometrySelectionMode('face')
      useEditor.getState().selectContourFace('front', 0, -1, 0)
    })
    const { container } = render(<Properties />)
    expect(screen.getByText('Flächenbearbeitung')).toBeInTheDocument()
    fireEvent.change(
      screen
        .getByText('Verschiebung X')
        .closest('label')!
        .querySelector('input')!,
      { target: { value: '3' } },
    )
    fireEvent.change(
      screen
        .getByText('Verschiebung Y')
        .closest('label')!
        .querySelector('input')!,
      { target: { value: '-2' } },
    )
    fireEvent.click(screen.getByText('Auswahl verschieben'))
    expect(
      useEditor.getState().panels.find(({ id }) => id === 'front')?.shape,
    ).toMatchObject({ type: 'rectangle', editedFaces: expect.any(Array) })
    act(() => useEditor.getState().setGeometrySelectionMode('edge'))
    expect(screen.getByText('Kantenbearbeitung')).toBeInTheDocument()
    expect(container.querySelector('.contour-move')).toBeNull()
    act(() => useEditor.getState().selectContourEdge('front', 0, -1, 1))
    expect(container.querySelector('.contour-move')).not.toBeNull()
    act(() => useEditor.getState().setGeometrySelectionMode('object'))
    expect(container.querySelector('.contour-editor')).toBeNull()
  })
})
