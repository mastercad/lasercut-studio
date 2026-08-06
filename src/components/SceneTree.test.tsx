import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEditor } from '../store/editor'
import { SceneTree } from './SceneTree'

beforeEach(() => {
  useEditor.getState().newProject('box')
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:group'),
    revokeObjectURL: vi.fn(),
  })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(
    () => undefined,
  )
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('SceneTree', () => {
  it('selects, additively selects, keyboard-selects and renames panels', async () => {
    const user = userEvent.setup()
    const { container } = render(<SceneTree />)
    fireEvent.click(container.querySelector('.tree-root')!)
    expect(useEditor.getState().selectedGroupId).toBe('group-1')
    const frontInput = screen.getByLabelText('Vorderseite umbenennen')
    const backInput = screen.getByLabelText('Rückseite umbenennen')
    fireEvent.click(container.querySelector('.tree-root input')!)
    fireEvent.click(frontInput.closest('[role="button"]')!)
    fireEvent.click(backInput.closest('[role="button"]')!, { ctrlKey: true })
    expect(useEditor.getState().selectedPanels).toEqual(['front', 'back'])
    fireEvent.keyDown(frontInput.closest('[role="button"]')!, { key: 'Enter' })
    expect(useEditor.getState().selectedPanels).toEqual(['front'])
    await user.clear(frontInput)
    await user.type(frontInput, 'Neue Front')
    fireEvent.blur(frontInput)
    expect(
      useEditor.getState().panels.find(({ id }) => id === 'front')?.label,
    ).toBe('Neue Front')
  })

  it('rejects an empty rename and restores Escape edits', () => {
    render(<SceneTree />)
    const input = screen.getByLabelText('Vorderseite umbenennen')
    fireEvent.change(input, { target: { value: '  ' } })
    fireEvent.blur(input)
    expect(input).toHaveValue('Vorderseite')
    fireEvent.change(input, { target: { value: 'Nicht speichern' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(
      useEditor.getState().panels.find(({ id }) => id === 'front')?.label,
    ).toBe('Vorderseite')
  })

  it('toggles individual and complete-group visibility', async () => {
    render(<SceneTree />)
    fireEvent.click(screen.getAllByTitle('Objekt ausblenden')[0])
    expect(useEditor.getState().panels[0].visible).toBe(false)
    await userEvent.click(
      screen.getByTitle('Alle Teile der Baugruppe einblenden'),
    )
    expect(
      useEditor.getState().panels.every((panel) => panel.visible !== false),
    ).toBe(true)
    await userEvent.click(screen.getByTitle('Baugruppe ausblenden'))
    expect(useEditor.getState().groups[0].visible).toBe(false)
  })

  it('collapses and expands groups without losing their children', async () => {
    const { container } = render(<SceneTree />)
    const collapse = container.querySelector('.tree-root > button')!
    fireEvent.click(collapse)
    expect(
      screen.queryByLabelText('Vorderseite umbenennen'),
    ).not.toBeInTheDocument()
    fireEvent.click(collapse)
    expect(screen.getByLabelText('Vorderseite umbenennen')).toBeInTheDocument()
  })

  it('creates an empty group or groups the current selection and assigns objects', async () => {
    const user = userEvent.setup()
    const view = render(<SceneTree />)
    await user.click(screen.getByText('Neue Gruppe'))
    expect(useEditor.getState().groups).toHaveLength(2)
    useEditor.getState().selectPanel('front')
    view.rerender(<SceneTree />)
    await user.click(screen.getByText('Aus Auswahl gruppieren'))
    expect(useEditor.getState().groups).toHaveLength(3)
    expect(useEditor.getState().groups.at(-1)?.panelIds).toEqual(['front'])
    fireEvent.change(view.container.querySelector('.group-toolbar select')!, {
      target: { value: 'group-1' },
    })
    expect(
      useEditor.getState().groups.find(({ id }) => id === 'group-1')?.panelIds,
    ).toContain('front')
  })

  it('renames, duplicates, saves, opens for manufacturing and deletes a group', async () => {
    vi.useFakeTimers()
    const view = render(<SceneTree />)
    const groupName =
      view.container.querySelector<HTMLInputElement>('.tree-root input')!
    fireEvent.change(groupName, { target: { value: 'Mein / Projekt' } })
    expect(useEditor.getState().groups[0].name).toBe('Mein / Projekt')
    const openMenu = () =>
      fireEvent.click(screen.getAllByTitle('Weitere Aktionen')[0])
    openMenu()
    fireEvent.click(screen.getByText('Baugruppe kopieren'))
    expect(useEditor.getState().groups).toHaveLength(2)
    openMenu()
    fireEvent.click(screen.getByText('Als Projekt speichern'))
    expect(URL.createObjectURL).toHaveBeenCalledOnce()
    act(() => vi.advanceTimersByTime(1000))
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:group')
    openMenu()
    fireEvent.click(screen.getByText('In Fertigung öffnen'))
    expect(useEditor.getState().workspace).toBe('unfold')
    openMenu()
    fireEvent.click(screen.getByText('Baugruppe löschen'))
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Abbrechen'))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    openMenu()
    fireEvent.click(screen.getByText('Baugruppe löschen'))
    fireEvent.click(screen.getByRole('button', { name: 'Baugruppe löschen' }))
    expect(useEditor.getState().groups.some(({ id }) => id === 'group-1')).toBe(
      false,
    )
    vi.useRealTimers()
  })

  it('shows ungrouped panels, adds every object type and selects nested laser text', () => {
    useEditor.setState({ groups: [] })
    const view = render(<SceneTree />)
    expect(screen.getByText('Nicht gruppiert')).toBeInTheDocument()
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
      useEditor
        .getState()
        .panels.slice(-6)
        .map((panel) => panel.shape?.type),
    ).toEqual(['rectangle', 'triangle', 'circle', 'star', 'polygon', 'text'])
    const ungrouped = view.container.querySelector('.project-group.ungrouped')!
    const firstItem = ungrouped.querySelector<HTMLElement>('[role="button"]')!
    fireEvent.click(firstItem)
    const firstVisibility = ungrouped.querySelector<HTMLButtonElement>(
      '[title="Objekt ausblenden"]',
    )!
    fireEvent.click(firstVisibility)
    const firstName = ungrouped.querySelector<HTMLInputElement>('input')!
    fireEvent.change(firstName, { target: { value: 'Ungruppiert geändert' } })
    fireEvent.blur(firstName)
    expect(useEditor.getState().panels[0]).toMatchObject({
      label: 'Ungruppiert geändert',
      visible: false,
    })

    useEditor.getState().addLaserText('front')
    useEditor.setState({
      groups: [
        { id: 'texts', name: 'Texte', panelIds: ['front'], visible: true },
      ],
    })
    view.rerender(<SceneTree />)
    const textItem = screen.getByText('Text 1').closest('[role="button"]')!
    fireEvent.keyDown(textItem, { key: ' ' })
    expect(useEditor.getState().selectedTextId).toBe(
      useEditor.getState().laserTexts[0].id,
    )
  })
})
