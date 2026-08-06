import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PerspectiveCamera, Raycaster, Scene } from 'three'
import { useEditor } from '../store/editor'

const threeContext = vi.hoisted(() => ({
  canvas: null as HTMLCanvasElement | null,
  camera: null as PerspectiveCamera | null,
  raycaster: null as Raycaster | null,
  scene: null as Scene | null,
}))

vi.mock('@react-three/fiber', () => ({
  Canvas: ({
    children,
    onPointerMissed,
  }: {
    children: React.ReactNode
    onPointerMissed: () => void
  }) => (
    <div data-testid="canvas-host">
      <canvas data-testid="three-canvas" onClick={onPointerMissed} />
      {children}
    </div>
  ),
  useThree: () => ({
    gl: { domElement: threeContext.canvas },
    camera: threeContext.camera,
    raycaster: threeContext.raycaster,
    scene: threeContext.scene,
    size: { width: 800, height: 400 },
    invalidate: vi.fn(),
  }),
}))

vi.mock('@react-three/drei', () => ({
  Edges: () => <i data-testid="preview-edges" />,
  Environment: () => null,
  Grid: () => null,
  GizmoHelper: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  GizmoViewport: () => null,
  Html: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Line: ({
    points,
    color,
    onClick,
    onPointerDown,
  }: {
    points: unknown[]
    color: string
    onClick?: React.MouseEventHandler
    onPointerDown?: React.PointerEventHandler
  }) => (
    <button
      data-testid="three-line"
      data-points={JSON.stringify(points)}
      data-color={color}
      onClick={onClick}
      onPointerDown={onPointerDown}
    />
  ),
  OrbitControls: () => null,
  PerspectiveCamera: () => null,
  TransformControls: ({
    object,
    mode,
    onMouseDown,
    onMouseUp,
    onObjectChange,
  }: {
    object: React.MutableRefObject<unknown>
    mode: string
    onMouseDown?: () => void
    onMouseUp?: () => void
    onObjectChange?: () => void
  }) => {
    type MockTransformObject = {
      position: {
        x: number
        y: number
        z: number
        toArray: () => number[]
        set: (x: number, y: number, z: number) => void
      }
      rotation: { x: number; y: number; z: number }
      scale: {
        x: number
        y: number
        z: number
        getComponent: (axis: number) => number
        set: (x: number, y: number, z: number) => void
      }
    }
    const reference =
      object as React.MutableRefObject<MockTransformObject | null>
    const simulated = React.useRef<MockTransformObject | null>(null)
    const ensureObject = () => {
      const current = reference.current as Partial<MockTransformObject> | null
      if (current?.position?.toArray) {
        simulated.current = current as MockTransformObject
        return simulated.current
      }
      if (simulated.current) {
        reference.current = simulated.current
        return simulated.current
      }
      const created: MockTransformObject = {
        position: {
          x: 0,
          y: 0,
          z: 0,
          toArray: () => [
            created.position.x,
            created.position.y,
            created.position.z,
          ],
          set: (x: number, y: number, z: number) =>
            Object.assign(created.position, { x, y, z }),
        },
        rotation: { x: 0, y: 0, z: 0 },
        scale: {
          x: 1,
          y: 1,
          z: 1,
          getComponent: (axis: number) =>
            [created.scale.x, created.scale.y, created.scale.z][axis],
          set: (x: number, y: number, z: number) =>
            Object.assign(created.scale, { x, y, z }),
        },
      }
      simulated.current = created
      reference.current = created
      return created
    }
    return (
      <button
        data-testid={`transform-${mode}`}
        onMouseDown={() => {
          ensureObject()
          onMouseDown?.()
        }}
        onMouseMove={() => {
          const target = ensureObject()
          target.position.x = 17
          target.rotation.y = Math.PI / 4
          target.scale.x = 2
          onObjectChange?.()
        }}
        onMouseUp={() => {
          ensureObject()
          onMouseUp?.()
        }}
      />
    )
  },
}))

vi.mock('../model/fonts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../model/fonts')>()),
  createSystemTextOutline: vi.fn(async () => ({
    commands: [],
    width: 42,
    height: 12,
  })),
}))

import {
  AlignmentGuides,
  ContourEditorOverlay,
  EditorReliefHole,
  ExtrudedTextContour,
  JointPreviewOverlay,
  PreviewShape,
  SideFaceTarget,
  Viewport,
} from './Viewport'
import { panelIdOf } from './viewportUtils'

beforeEach(() => {
  useEditor.getState().newProject('box')
  useEditor.setState({
    transformMode: 'translate',
    transformConstraint: 'free',
    transformGridEnabled: false,
    selectedPanels: [],
    translationStep: 10,
    rotationStep: 15,
    scaleStep: 0.1,
  })
  threeContext.camera = new PerspectiveCamera(42, 2, 0.1, 5000)
  threeContext.raycaster = new Raycaster()
  threeContext.scene = new Scene()
  threeContext.camera.position.set(0, 0, 500)
  threeContext.camera.lookAt(0, 0, 0)
  threeContext.camera.updateProjectionMatrix()
  threeContext.camera.updateMatrixWorld()
  threeContext.canvas = document.createElement('canvas')
  vi.spyOn(threeContext.canvas, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 800,
    height: 400,
    right: 800,
    bottom: 400,
    x: 0,
    y: 0,
    toJSON: vi.fn(),
  })
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    configurable: true,
    value: vi.fn(),
  })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0)
    return 1
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Viewport editor controls', () => {
  it('shows current transform mode, constraint and grid steps', () => {
    const view = render(<Viewport />)
    expect(
      screen.getByText(
        (_, element) => element?.textContent === 'Ctrl-Raster: 10 mm',
      ),
    ).toBeInTheDocument()
    act(() =>
      useEditor.setState({
        transformMode: 'rotate',
        rotationStep: 22.5,
        transformConstraint: 'xy',
      }),
    )
    expect(screen.getByText('Fixiert: XY')).toBeInTheDocument()
    expect(
      screen.getByText(
        (_, element) => element?.textContent === 'Ctrl-Raster: 22.5°',
      ),
    ).toBeInTheDocument()
    act(() =>
      useEditor.setState({
        transformMode: 'scale',
        scaleStep: 0.125,
        transformGridEnabled: true,
      }),
    )
    expect(
      screen.getByText(
        (_, element) => element?.textContent === 'Raster aktiv: 12.5%',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText(/Raster aktiv/)).toBeInTheDocument()
    view.unmount()
  })

  it('handles G/R/S, axis, plane and Escape keyboard controls', () => {
    render(<Viewport />)
    fireEvent.keyDown(window, { key: 'r' })
    expect(useEditor.getState()).toMatchObject({
      transformMode: 'rotate',
      transformConstraint: 'free',
    })
    fireEvent.keyDown(window, { key: 'x' })
    expect(useEditor.getState().transformConstraint).toBe('x')
    fireEvent.keyDown(window, { key: 'x' })
    expect(useEditor.getState().transformConstraint).toBe('free')
    fireEvent.keyDown(window, { key: 'y', shiftKey: true })
    expect(useEditor.getState().transformConstraint).toBe('xz')
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.keyDown(window, { key: 's' })
    expect(useEditor.getState()).toMatchObject({
      transformMode: 'scale',
      transformConstraint: 'free',
    })
    fireEvent.keyDown(window, { key: 'g' })
    expect(useEditor.getState().transformMode).toBe('translate')
  })

  it('does not trigger editor shortcuts from inputs and prevents browser save', () => {
    render(
      <>
        <Viewport />
        <input aria-label="editor input" />
      </>,
    )
    const input = screen.getByLabelText('editor input')
    fireEvent.keyDown(input, { key: 'r' })
    expect(useEditor.getState().transformMode).toBe('translate')
    const save = new KeyboardEvent('keydown', {
      key: 's',
      ctrlKey: true,
      cancelable: true,
    })
    window.dispatchEvent(save)
    expect(save.defaultPrevented).toBe(true)
  })

  it('handles undo, redo and temporary modifier key release and window blur', () => {
    useEditor.getState().movePanel('front', [11, 12, 13])
    render(<Viewport />)
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(
      useEditor.getState().panels.find(({ id }) => id === 'front')?.position,
    ).not.toEqual([11, 12, 13])
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true })
    expect(
      useEditor.getState().panels.find(({ id }) => id === 'front')?.position,
    ).toEqual([11, 12, 13])
    fireEvent.keyDown(window, { key: 'Control' })
    fireEvent.keyUp(window, { key: 'Control' })
    fireEvent.keyDown(window, { key: 'Shift' })
    fireEvent.keyUp(window, { key: 'Shift' })
    fireEvent.blur(window)
  })

  it('deletes selected objects except while typing', () => {
    useEditor.getState().selectPanel('front')
    render(
      <>
        <Viewport />
        <input aria-label="editor input" />
      </>,
    )
    fireEvent.keyDown(screen.getByLabelText('editor input'), { key: 'Delete' })
    expect(useEditor.getState().panels.some(({ id }) => id === 'front')).toBe(
      true,
    )
    fireEvent.keyDown(window, { key: 'Delete' })
    expect(useEditor.getState().panels.some(({ id }) => id === 'front')).toBe(
      false,
    )
  })

  it('clears selection on an unsuppressed missed canvas click', () => {
    useEditor.getState().selectPanel('front')
    render(<Viewport />)
    fireEvent.click(screen.getByTestId('three-canvas'))
    expect(useEditor.getState().selectedPanels).toEqual([])
  })

  it('performs containing and additive crossing rubber-band selections', () => {
    const { container } = render(<Viewport />)
    const canvas = screen.getByTestId('three-canvas') as HTMLCanvasElement
    const viewport = container.querySelector<HTMLElement>('.viewport')!
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 800,
      height: 400,
      right: 800,
      bottom: 400,
      x: 0,
      y: 0,
      toJSON: vi.fn(),
    })
    fireEvent.pointerDown(canvas, {
      shiftKey: true,
      button: 0,
      pointerId: 1,
      clientX: 0,
      clientY: 0,
    })
    fireEvent.pointerMove(canvas, {
      shiftKey: true,
      pointerId: 1,
      clientX: 800,
      clientY: 400,
    })
    fireEvent.pointerUp(canvas, {
      shiftKey: true,
      pointerId: 1,
      clientX: 800,
      clientY: 400,
    })
    expect(useEditor.getState().selectedPanels.length).toBeGreaterThan(0)
    fireEvent.pointerDown(canvas, {
      shiftKey: true,
      ctrlKey: true,
      button: 0,
      pointerId: 2,
      clientX: 800,
      clientY: 400,
    })
    fireEvent.pointerMove(canvas, {
      shiftKey: true,
      ctrlKey: true,
      pointerId: 2,
      clientX: 0,
      clientY: 0,
    })
    fireEvent.pointerCancel(canvas, { pointerId: 2 })
    expect(viewport).not.toHaveClass('rubberband-active')
  })

  it('tracks ordinary viewport drags without accidentally clearing selection', () => {
    useEditor.getState().selectPanel('front')
    const { container } = render(<Viewport />)
    const canvas = screen.getByTestId('three-canvas')
    fireEvent.pointerDown(canvas, {
      button: 0,
      pointerId: 3,
      clientX: 10,
      clientY: 10,
    })
    fireEvent.pointerMove(canvas, { pointerId: 3, clientX: 20, clientY: 20 })
    fireEvent.pointerUp(canvas, { pointerId: 3, clientX: 20, clientY: 20 })
    expect(useEditor.getState().selectedPanels).toEqual(['front'])
    fireEvent.pointerCancel(container.querySelector('.viewport')!, {
      pointerId: 3,
    })
  })

  it('selects rendered panels additively and edits text directly on the canvas', async () => {
    const { container } = render(<Viewport />)
    fireEvent.click(container.querySelector('[name="panel-front"]')!)
    expect(useEditor.getState().selectedPanels).toEqual(['front'])
    fireEvent.click(container.querySelector('[name="panel-back"]')!, {
      ctrlKey: true,
    })
    expect(useEditor.getState().selectedPanels).toEqual(['front', 'back'])

    act(() => useEditor.getState().newProject('empty'))
    act(() => useEditor.getState().addShape('text'))
    const textPanel = useEditor.getState().panels[0]
    fireEvent.doubleClick(
      container.querySelector(`[name="panel-${textPanel.id}"]`)!,
    )
    const input = screen.getByLabelText('Text direkt bearbeiten')
    fireEvent.change(input, { target: { value: 'Neue Gravur' } })
    fireEvent.blur(input)
    await vi.waitFor(() =>
      expect(useEditor.getState().panels[0].shape).toMatchObject({
        type: 'text',
        text: 'Neue Gravur',
      }),
    )
    expect(useEditor.getState().panels[0].size.slice(0, 2)).toEqual([42, 12])
  })

  it('cancels direct text edits with Escape and commits them with Enter', async () => {
    act(() => useEditor.getState().newProject('empty'))
    act(() => useEditor.getState().addShape('text'))
    const panel = useEditor.getState().panels[0]
    const { container } = render(<Viewport />)
    fireEvent.doubleClick(
      container.querySelector(`[name="panel-${panel.id}"]`)!,
    )
    let input = screen.getByLabelText('Text direkt bearbeiten')
    fireEvent.pointerDown(input)
    fireEvent.doubleClick(input)
    fireEvent.change(input, { target: { value: 'Verwerfen' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(useEditor.getState().panels[0].shape).toMatchObject({
      type: 'text',
      text: 'Text',
    })
    fireEvent.doubleClick(
      container.querySelector(`[name="panel-${panel.id}"]`)!,
    )
    input = screen.getByLabelText('Text direkt bearbeiten')
    fireEvent.change(input, { target: { value: 'Übernehmen' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await vi.waitFor(() =>
      expect(useEditor.getState().panels[0].shape).toMatchObject({
        type: 'text',
        text: 'Übernehmen',
      }),
    )
  })

  it('previews and commits translate, rotate and scale transform controls', () => {
    useEditor.getState().selectPanel('front')
    render(<Viewport />)
    const translate = screen.getByTestId('transform-translate')
    fireEvent.mouseDown(translate)
    fireEvent.mouseMove(translate)
    expect(useEditor.getState().rotationPreview).toMatchObject({
      panelId: 'front',
      position: [17, 0, 0],
    })
    fireEvent.mouseUp(translate)
    expect(
      useEditor.getState().panels.find(({ id }) => id === 'front')?.position[0],
    ).toBe(17)
    expect(useEditor.getState().rotationPreview).toBeNull()

    act(() => useEditor.getState().setTransformMode('rotate'))
    const rotate = screen.getByTestId('transform-rotate')
    fireEvent.mouseDown(rotate)
    fireEvent.mouseMove(rotate)
    fireEvent.mouseUp(rotate)
    expect(
      useEditor.getState().panels.find(({ id }) => id === 'front')?.rotation[1],
    ).toBeCloseTo(Math.PI / 4)

    const width = useEditor.getState().panels.find(({ id }) => id === 'front')!
      .size[0]
    act(() => useEditor.getState().setTransformMode('scale'))
    const scale = screen.getByTestId('transform-scale')
    fireEvent.mouseDown(scale)
    fireEvent.mouseMove(scale)
    fireEvent.mouseUp(scale)
    expect(
      useEditor.getState().panels.find(({ id }) => id === 'front')?.size[0],
    ).toBe(width * 2)
  })

  it('previews and commits complete group transformations', () => {
    useEditor.getState().selectGroup('group-1')
    const before = useEditor.getState().panels.find(({ id }) => id === 'front')!
    render(<Viewport />)
    const control = screen.getByTestId('transform-translate')
    fireEvent.mouseDown(control)
    fireEvent.mouseMove(control)
    fireEvent.mouseUp(control)
    const after = useEditor.getState().panels.find(({ id }) => id === 'front')!
    expect(after.position[0]).not.toBe(before.position[0])
  })
})

describe('Viewport 3D overlays', () => {
  it('builds selectable side-face geometry and both closed text-contour skins', () => {
    const onSelect = vi.fn()
    const side = render(
      <SideFaceTarget
        lowerA={[0, 0, 0]}
        lowerB={[10, 0, 0]}
        upperA={[0, 0, 3]}
        upperB={[10, 0, 3]}
        selected
        onSelect={onSelect}
      />,
    )
    fireEvent.pointerDown(side.container.querySelector('mesh')!)
    fireEvent.click(side.container.querySelector('mesh')!)
    expect(onSelect).toHaveBeenCalledTimes(2)
    side.unmount()

    const contour = render(
      <ExtrudedTextContour
        points={[
          [0, 0],
          [10, 0],
          [10, 5],
          [0, 0],
        ]}
        thickness={3}
        color="#123456"
      />,
    )
    expect(contour.container.querySelectorAll('mesh')).toHaveLength(1)
    expect(screen.getAllByTestId('three-line')).toHaveLength(2)
    contour.unmount()
    const empty = render(
      <ExtrudedTextContour points={[[0, 0]]} thickness={3} color="#000000" />,
    )
    expect(empty.container).toBeEmptyDOMElement()
  })

  it('renders box, cylindrical and relief previews on every supported axis', () => {
    const view = render(
      <>
        <PreviewShape center={[0, 0, 0]} size={[10, 20, 3]} operation="add" />
        <PreviewShape
          center={[0, 0, 0]}
          size={[10, 20, 3]}
          operation="subtract"
          shape="cylinder"
          axis={0}
        />
        <PreviewShape
          center={[0, 0, 0]}
          size={[10, 20, 3]}
          operation="subtract"
          shape="cylinder"
          axis={2}
          color="#ffffff"
        />
        <EditorReliefHole
          feature={{
            id: 'relief-x',
            jointId: 'joint',
            operation: 'subtract',
            shape: 'cylinder',
            center: [0, 0, 0],
            size: [3, 4, 5],
            axis: 0,
          }}
        />
        <EditorReliefHole
          feature={{
            id: 'relief-z',
            jointId: 'joint',
            operation: 'subtract',
            shape: 'cylinder',
            center: [0, 0, 0],
            size: [3, 4, 5],
            axis: 2,
          }}
        />
      </>,
    )
    expect(view.container.querySelectorAll('boxGeometry')).toHaveLength(1)
    expect(view.container.querySelectorAll('cylinderGeometry')).toHaveLength(4)
  })

  it('renders snapped, free and distance guide variants with their labels', () => {
    const view = render(
      <AlignmentGuides
        guides={[
          {
            axis: 0,
            kind: 'alignment',
            snapped: true,
            label: 'X fluchtet',
            points: [
              [0, 0, 0],
              [1, 0, 0],
            ],
            position: [0, 0, 0],
          },
          {
            axis: 1,
            kind: 'alignment',
            snapped: false,
            label: 'Y frei',
            points: [
              [0, 0, 0],
              [0, 1, 0],
            ],
            position: [0, 0, 0],
          },
          {
            axis: 2,
            kind: 'distance',
            snapped: false,
            label: '12 mm',
            points: [
              [0, 0, 0],
              [0, 0, 1],
            ],
            position: [0, 0, 0],
          },
        ]}
      />,
    )
    expect(screen.getAllByTestId('three-line')).toHaveLength(3)
    expect(screen.getByText('X fluchtet')).toHaveClass('snapped')
    expect(screen.getByText('12 mm')).toHaveClass('distance')
    const distanceLabel = screen.getByText('12 mm')
    view.rerender(
      <AlignmentGuides
        guides={[
          {
            axis: 2,
            kind: 'distance',
            snapped: false,
            label: '11,9 mm',
            points: [
              [0, 0, 0.1],
              [0, 0, 1],
            ],
            position: [0, 0, 0.55],
          },
        ]}
      />,
    )
    expect(screen.getByText('11,9 mm')).toBe(distanceLabel)
  })

  it('renders joint previews only for existing panels and all cut/feature kinds', () => {
    const panel = useEditor.getState().panels.find(({ id }) => id === 'front')!
    act(() =>
      useEditor.getState().setJointPreview([
        {
          panelId: panel.id,
          color: '#abcdef',
          cuts: [
            { id: 'cut', kind: 'hole', center: [0, 0, 0], size: [5, 6, 3] },
          ],
          features: [
            {
              id: 'feature',
              jointId: 'joint',
              operation: 'add',
              shape: 'box',
              center: [0, 0, 0],
              size: [4, 5, 3],
            },
          ],
        },
        { panelId: 'missing', cuts: [], features: [] },
      ]),
    )
    const view = render(<JointPreviewOverlay />)
    expect(view.container.querySelectorAll('boxGeometry')).toHaveLength(2)
    act(() => useEditor.getState().setJointPreview(null))
    expect(view.container.querySelectorAll('mesh')).toHaveLength(0)
    expect(view.container.querySelectorAll('boxGeometry')).toHaveLength(0)
  })

  it('renders and switches complete face and edge contour selection overlays', () => {
    const panel = useEditor.getState().panels.find(({ id }) => id === 'front')!
    act(() => useEditor.getState().setGeometrySelectionMode('face'))
    const view = render(<ContourEditorOverlay panel={panel} />)
    const face = view.container.querySelector('mesh')!
    fireEvent.pointerDown(face)
    expect(useEditor.getState().contourSelection).toMatchObject({
      panelId: 'front',
      kind: 'face',
    })
    const handle = screen.getByTestId('transform-translate')
    fireEvent.mouseDown(handle)
    fireEvent.mouseMove(handle)
    fireEvent.mouseUp(handle)
    act(() => useEditor.getState().setGeometrySelectionMode('edge'))
    expect(screen.getAllByTestId('three-line').length).toBeGreaterThan(0)
    fireEvent.pointerDown(screen.getAllByTestId('three-line')[1])
    expect(useEditor.getState().contourSelection).toMatchObject({
      panelId: 'front',
      kind: 'edge',
    })
    act(() => useEditor.getState().setGeometrySelectionMode('object'))
    expect(view.container).toBeEmptyDOMElement()
  })

  it('resolves panel ids through nested Three.js object parents', () => {
    const parent = new Scene()
    parent.userData.panelId = 'front'
    const child = new Scene()
    parent.add(child)
    expect(panelIdOf(child)).toBe('front')
    expect(panelIdOf(new Scene())).toBeNull()
    expect(panelIdOf(null)).toBeNull()
  })
})
