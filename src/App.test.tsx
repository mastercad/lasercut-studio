import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEditor } from './store/editor'

vi.mock('./components/Toolbar', () => ({
  Toolbar: () => <div>Toolbar mock</div>,
}))
vi.mock('./components/SceneTree', () => ({
  SceneTree: () => <div>SceneTree mock</div>,
}))
vi.mock('./components/Properties', () => ({
  Properties: () => <div>Properties mock</div>,
}))
vi.mock('./components/Viewport', () => ({
  Viewport: () => <div>Viewport mock</div>,
}))
vi.mock('./components/ExportWorkspace', () => ({
  ExportWorkspace: () => <div>ExportWorkspace mock</div>,
}))
vi.mock('./components/LaserManager', () => ({
  LaserManager: () => <div>LaserManager mock</div>,
}))

import App from './App'

beforeEach(() => {
  localStorage.clear()
  useEditor.setState({ workspace: 'model' })
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    configurable: true,
    value: vi.fn(),
  })
})

afterEach(cleanup)

describe('App shell', () => {
  it('switches workspaces and renders the matching center and sidebar', () => {
    render(<App />)
    expect(screen.getByText('Viewport mock')).toBeInTheDocument()
    expect(screen.getByText('Properties mock')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Fertigung'))
    expect(screen.getByText('ExportWorkspace mock')).toBeInTheDocument()
    expect(screen.getByText('LaserManager mock')).toBeInTheDocument()
    fireEvent.click(screen.getByText('3D-Modell'))
    expect(useEditor.getState().workspace).toBe('model')
  })

  it('loads clamped persisted sidebar widths and tolerates malformed storage', () => {
    localStorage.setItem(
      'lasercut-studio.ui.v1',
      JSON.stringify({ left: 999, right: 10 }),
    )
    const view = render(<App />)
    const grid = view.container.querySelector<HTMLElement>('.editor-grid')!
    expect(grid.style.getPropertyValue('--sidebar-left')).toBe('520px')
    expect(grid.style.getPropertyValue('--sidebar-right')).toBe('240px')
    view.unmount()
    localStorage.setItem('lasercut-studio.ui.v1', '{bad')
    const second = render(<App />).container.querySelector<HTMLElement>(
      '.editor-grid',
    )!
    expect(second.style.getPropertyValue('--sidebar-left')).toBe('235px')
  })

  it('resizes, persists and resets both sidebars', () => {
    const { container } = render(<App />)
    const grid = container.querySelector<HTMLElement>('.editor-grid')!
    vi.spyOn(grid, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      right: 1200,
      width: 1200,
      top: 0,
      bottom: 800,
      height: 800,
      x: 0,
      y: 0,
      toJSON: vi.fn(),
    })
    const left = screen.getByLabelText(
      'Linke Seitenleiste vergrößern oder verkleinern',
    )
    fireEvent.pointerDown(left, { pointerId: 1 })
    fireEvent.pointerMove(left, { pointerId: 1, clientX: 330 })
    fireEvent.pointerUp(left, { pointerId: 1 })
    expect(grid.style.getPropertyValue('--sidebar-left')).toBe('330px')
    expect(
      JSON.parse(localStorage.getItem('lasercut-studio.ui.v1')!),
    ).toMatchObject({ left: 330 })

    const right = screen.getByLabelText(
      'Rechte Seitenleiste vergrößern oder verkleinern',
    )
    fireEvent.pointerDown(right, { pointerId: 2 })
    fireEvent.pointerMove(right, { pointerId: 2, clientX: 820 })
    fireEvent.pointerCancel(right, { pointerId: 2 })
    expect(grid.style.getPropertyValue('--sidebar-right')).toBe('380px')
    fireEvent.doubleClick(left)
    fireEvent.doubleClick(right)
    expect(grid.style.getPropertyValue('--sidebar-left')).toBe('235px')
    expect(grid.style.getPropertyValue('--sidebar-right')).toBe('284px')
  })

  it('ignores pointer movements and releases from unrelated pointers', () => {
    const { container } = render(<App />)
    const grid = container.querySelector<HTMLElement>('.editor-grid')!
    vi.spyOn(grid, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      right: 1000,
      width: 1000,
      top: 0,
      bottom: 500,
      height: 500,
      x: 0,
      y: 0,
      toJSON: vi.fn(),
    })
    const left = screen.getByLabelText(
      'Linke Seitenleiste vergrößern oder verkleinern',
    )
    fireEvent.pointerMove(left, { pointerId: 9, clientX: 400 })
    fireEvent.pointerDown(left, { pointerId: 1 })
    fireEvent.pointerMove(left, { pointerId: 2, clientX: 400 })
    fireEvent.pointerUp(left, { pointerId: 2 })
    expect(grid.style.getPropertyValue('--sidebar-left')).toBe('235px')
  })
})
