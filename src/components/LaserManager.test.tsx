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
import { useEditor } from '../store/editor'
import {
  createDefaultLaserPresets,
  createDefaultProcessingProfiles,
  createDefaultProcessingRecipes,
  defaultLaserCutters,
} from '../model/export'
import { LaserManager } from './LaserManager'

beforeEach(() => {
  useEditor.getState().newProject('box')
  const profiles = createDefaultProcessingProfiles()
  useEditor.setState({
    laserCutters: defaultLaserCutters,
    activeLaserId: defaultLaserCutters[0].id,
    processingProfiles: profiles,
    laserPresets: createDefaultLaserPresets(
      defaultLaserCutters,
      useEditor.getState().materials,
    ),
    processingRecipes: createDefaultProcessingRecipes(
      profiles,
      defaultLaserCutters,
      useEditor.getState().materials,
    ),
  })
})
afterEach(cleanup)

const assignFirstProfile = () => {
  const state = useEditor.getState()
  const profile = state.processingProfiles[0]
  useEditor.setState({
    panels: state.panels.map((panel) =>
      panel.id === 'front'
        ? {
            ...panel,
            processingAssignments: [
              {
                id: 'assignment-test',
                profileId: profile.id,
                geometry: profile.geometry,
              },
            ],
          }
        : panel,
    ),
  })
  return profile
}

describe('LaserManager', () => {
  it('renders nothing without a laser and falls back to the first laser for an invalid active id', () => {
    const lasers = useEditor.getState().laserCutters
    useEditor.setState({ activeLaserId: 'missing' })
    const view = render(<LaserManager />)
    expect(screen.getByText('Layer-Einstellungen')).toBeInTheDocument()
    view.unmount()
    useEditor.setState({ laserCutters: [], activeLaserId: '' })
    render(<LaserManager />)
    expect(screen.queryByText('Layer-Einstellungen')).not.toBeInTheDocument()
    useEditor.setState({ laserCutters: lasers })
  })

  it('edits machine data, clamps watts and creates a copied machine', async () => {
    const user = userEvent.setup()
    const { container } = render(<LaserManager />)
    await user.click(screen.getByText('Maschinendaten bearbeiten'))
    const panel = container.querySelector('.machine-details-panel')!
    const name = within(panel as HTMLElement)
      .getByText('Name')
      .closest('label')!
      .querySelector('input')!
    const watts = within(panel as HTMLElement)
      .getByText('Leistung')
      .closest('label')!
      .querySelector('input')!
    const unit = within(panel as HTMLElement)
      .getByText('Einheit')
      .closest('label')!
      .querySelector('select')!
    const notes = within(panel as HTMLElement)
      .getByText('Notizen')
      .closest('label')!
      .querySelector('textarea')!
    fireEvent.change(name, { target: { value: 'Werkstattlaser' } })
    fireEvent.change(watts, { target: { value: '0' } })
    fireEvent.change(unit, { target: { value: 'mm/s' } })
    fireEvent.change(notes, { target: { value: 'Testnotiz' } })
    await user.click(within(panel as HTMLElement).getByText('Speichern'))
    expect(useEditor.getState().laserCutters[0]).toMatchObject({
      name: 'Werkstattlaser',
      powerWatts: 1,
      speedUnit: 'mm/s',
      notes: 'Testnotiz',
    })
    await user.click(screen.getByTitle('Neue Maschine als Kopie'))
    expect(useEditor.getState().laserCutters.at(-1)).toMatchObject({
      name: 'Werkstattlaser Kopie',
      powerWatts: 1,
    })
    await user.click(screen.getByText('Maschinendaten schließen'))
    expect(
      container.querySelector('.machine-details-panel'),
    ).not.toBeInTheDocument()
  })

  it('switches machines and synchronizes the machine form', () => {
    const original = useEditor.getState().laserCutters[0]
    useEditor.getState().addLaserCutter({
      name: 'Zweitlaser',
      powerWatts: 60,
      speedUnit: 'mm/s',
      notes: 'B',
    })
    useEditor.getState().selectLaserCutter(original.id)
    const { container } = render(<LaserManager />)
    const laserSelect = container.querySelector<HTMLSelectElement>(
      '.laser-manager > label select',
    )!
    fireEvent.change(laserSelect, {
      target: { value: useEditor.getState().laserCutters.at(-1)!.id },
    })
    expect(useEditor.getState().activeLaserId).toBe(
      useEditor.getState().laserCutters.at(-1)!.id,
    )
    fireEvent.click(screen.getByText('Maschinendaten bearbeiten'))
    expect(
      container.querySelector<HTMLInputElement>(
        '.machine-details-panel input',
      )!,
    ).toHaveValue('Zweitlaser')
  })

  it('edits and saves inner and outer automatic cut layers with clamped values', async () => {
    const user = userEvent.setup()
    const { container } = render(<LaserManager />)
    for (const name of ['Innenschnitte', 'Außenschnitte']) {
      fireEvent.click(screen.getByText(name))
      const editor = container.querySelector<HTMLElement>(
        '.layer-recipe-editor',
      )!
      const inputs = editor.querySelectorAll<HTMLInputElement>('input')
      fireEvent.change(inputs[0], { target: { value: '#123456' } })
      await user.clear(inputs[1])
      await user.type(inputs[1], '25')
      await user.clear(inputs[2])
      await user.type(inputs[2], '75')
      fireEvent.change(inputs[3], { target: { value: '2' } })
      await user.click(inputs[4])
      await user.click(screen.getByText('Layer-Einstellungen speichern'))
    }
    const state = useEditor.getState()
    const materialId = state.materials[0].id
    for (const operation of ['cut-inner', 'cut-outer'])
      expect(
        state.laserPresets.find(
          (preset) =>
            preset.materialId === materialId && preset.operation === operation,
        ),
      ).toMatchObject({
        layerColor: '#123456',
        speed: 25,
        power: 75,
        passes: 2,
        airAssist: false,
      })
  })

  it('creates and edits a profile recipe including fill-only values', async () => {
    const user = userEvent.setup()
    const profile = assignFirstProfile()
    const { container } = render(<LaserManager />)
    fireEvent.click(screen.getByText(profile.name))
    const editor = container.querySelector<HTMLElement>('.layer-recipe-editor')!
    const labels = (text: string) =>
      within(editor).getByText(text).closest('label')!.querySelector('input')!
    for (const [label, value] of [
      ['Geschwindigkeit', '250'],
      ['Leistung', '35'],
    ] as const) {
      const input = labels(label)
      await user.clear(input)
      await user.type(input, value)
    }
    fireEvent.change(labels('Durchgänge'), { target: { value: '3' } })
    fireEvent.change(labels('Linienabstand'), { target: { value: '0' } })
    fireEvent.change(labels('Fokusversatz'), { target: { value: '-1.2' } })
    await user.click(
      within(editor)
        .getByText('Air Assist')
        .closest('label')!
        .querySelector('input')!,
    )
    await user.click(screen.getByText('Layer-Einstellungen speichern'))
    expect(
      useEditor
        .getState()
        .processingRecipes.find((recipe) => recipe.profileId === profile.id),
    ).toMatchObject({
      speed: 250,
      power: 35,
      passes: 3,
      lineInterval: 0.01,
      focusOffset: -1.2,
      airAssist: true,
    })
    expect(screen.getByText('Vollständig')).toBeInTheDocument()
    fireEvent.click(screen.getByText(profile.name))
    expect(labels('Geschwindigkeit')).toHaveValue(250)
    fireEvent.click(screen.getByText('Zur Übersicht'))
  })

  it('cancels recipe editing without saving and changes material scope', () => {
    const profile = assignFirstProfile()
    const { container } = render(<LaserManager />)
    fireEvent.click(screen.getByText(profile.name))
    fireEvent.change(
      within(container.querySelector<HTMLElement>('.layer-recipe-editor')!)
        .getByText('Geschwindigkeit')
        .closest('label')!
        .querySelector('input')!,
      { target: { value: '999' } },
    )
    fireEvent.click(screen.getByText('Abbrechen'))
    expect(
      useEditor
        .getState()
        .processingRecipes.some((recipe) => recipe.speed === 999),
    ).toBe(false)
    act(() =>
      useEditor.setState({
        panels: useEditor
          .getState()
          .panels.map((panel, index) =>
            index === 1 ? { ...panel, materialId: 'birch-5' } : panel,
          ),
      }),
    )
    const materialSelect = container.querySelector<HTMLSelectElement>(
      '.material-focus select',
    )!
    fireEvent.change(materialSelect, { target: { value: 'birch-5' } })
    expect(materialSelect).toHaveValue('birch-5')
  })

  it('shows the no-layer state when objects have neither profiles nor automatic cuts', () => {
    const state = useEditor.getState()
    useEditor.setState({
      panels: state.panels.map((panel) => ({
        ...panel,
        autoCut: false,
        processingAssignments: [],
      })),
    })
    render(<LaserManager />)
    expect(screen.getByText(/keine Laser-Layer/)).toBeInTheDocument()
  })
})
