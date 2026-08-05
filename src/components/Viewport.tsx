import {
  Environment,
  Grid,
  GizmoHelper,
  GizmoViewport,
  Html,
  Line,
  OrbitControls,
  PerspectiveCamera,
  TransformControls,
} from '@react-three/drei'
import { Canvas, useThree } from '@react-three/fiber'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  BufferGeometry,
  DoubleSide,
  Euler,
  Quaternion,
  Vector2,
  Vector3,
  type Camera,
  type Group,
  type Mesh,
  type Object3D,
  type Raycaster,
  type Scene,
} from 'three'
import {
  createCachedEvaluatedPanelGeometry,
  panelGeometryKey,
} from '../model/panelGeometry'
import { useEditor } from '../store/editor'
import {
  calculateAlignmentGuides,
  calculateDistanceGuides,
  type AlignmentGuide,
} from '../model/alignment'
import { linkedBooleanToolIds } from '../model/booleanGraph'
import {
  snapPanelCoplanarPosition,
  snapPanelPosition,
  surfaceSnapDistance,
  worldHalfExtents,
} from '../model/snapping'
import { thinAxis, type JointFeature, type PanelDefinition } from '../model/box'
import { shapeToFreeContour, textOutlineShapes } from '../model/contours'
import { createSystemTextOutline } from '../model/fonts'

// TransformControls can finish by rebuilding connected geometry underneath
// the pointer. The browser then emits the click belonging to that same drag
// against the newly mounted receiver mesh. Suppress only that trailing click
// so it cannot replace the object the user just moved.
let suppressSceneSelectionUntil = 0
const beginSceneSelectionSuppression = () => {
  suppressSceneSelectionUntil = Number.POSITIVE_INFINITY
}
const finishSceneSelectionSuppression = () => {
  suppressSceneSelectionUntil = performance.now() + 250
}
const sceneSelectionSuppressed = () =>
  performance.now() < suppressSceneSelectionUntil

function SideFaceTarget({
  lowerA,
  lowerB,
  upperA,
  upperB,
  selected,
  onSelect,
}: {
  lowerA: [number, number, number]
  lowerB: [number, number, number]
  upperA: [number, number, number]
  upperB: [number, number, number]
  selected: boolean
  onSelect: (event: { stopPropagation: () => void }) => void
}) {
  const geometry = useMemo(() => {
    const result = new BufferGeometry().setFromPoints([
      new Vector3(...lowerA),
      new Vector3(...lowerB),
      new Vector3(...upperB),
      new Vector3(...upperA),
    ])
    result.setIndex([0, 1, 2, 0, 2, 3])
    result.computeVertexNormals()
    return result
  }, [lowerA.join(','), lowerB.join(','), upperA.join(','), upperB.join(',')])
  useEffect(() => () => geometry.dispose(), [geometry])
  return (
    <mesh
      geometry={geometry}
      renderOrder={72}
      onPointerDown={onSelect}
      onClick={onSelect}
    >
      <meshBasicMaterial
        color={selected ? '#fff36b' : '#67d7ff'}
        transparent
        opacity={selected ? 0.72 : 0.28}
        side={DoubleSide}
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
  )
}

function ExtrudedTextContour({
  points,
  thickness,
  color,
}: {
  points: [number, number][]
  thickness: number
  color: string
}) {
  const ring = useMemo(
    () =>
      points.length > 1 &&
      points[0][0] === points.at(-1)?.[0] &&
      points[0][1] === points.at(-1)?.[1]
        ? points.slice(0, -1)
        : points,
    [points],
  )
  const geometry = useMemo(() => {
    const result = new BufferGeometry()
    const vertices: Vector3[] = []
    const indices: number[] = []
    ring.forEach(([x, y]) => {
      vertices.push(
        new Vector3(x, y, -thickness / 2),
        new Vector3(x, y, thickness / 2),
      )
    })
    ring.forEach((_, index) => {
      const next = (index + 1) % ring.length
      const currentLower = index * 2,
        currentUpper = currentLower + 1,
        nextLower = next * 2,
        nextUpper = nextLower + 1
      indices.push(
        currentLower,
        nextLower,
        nextUpper,
        currentLower,
        nextUpper,
        currentUpper,
      )
    })
    result.setFromPoints(vertices)
    result.setIndex(indices)
    result.computeVertexNormals()
    return result
  }, [ring, thickness])
  useEffect(() => () => geometry.dispose(), [geometry])
  const front = ring.map(
    ([x, y]) => [x, y, thickness / 2 + 0.01] as [number, number, number],
  )
  const back = ring.map(
    ([x, y]) => [x, y, -thickness / 2 - 0.01] as [number, number, number],
  )
  if (ring.length < 2) return null
  return (
    <group>
      <mesh geometry={geometry}>
        <meshBasicMaterial color={color} side={DoubleSide} />
      </mesh>
      <Line points={[...front, front[0]]} color={color} lineWidth={1.25} />
      <Line points={[...back, back[0]]} color={color} lineWidth={1.25} />
    </group>
  )
}

function ContourEditorOverlay({ panel }: { panel: PanelDefinition }) {
  const handleRef = useRef<Group>(null!)
  const lastHandlePosition = useRef<[number, number, number] | null>(null)
  const lastSelectionKey = useRef('')
  const mode = useEditor((state) => state.geometrySelectionMode)
  const selection = useEditor((state) => state.contourSelection)
  const selectFace = useEditor((state) => state.selectContourFace)
  const selectEdge = useEditor((state) => state.selectContourEdge)
  const moveSelectedContour = useEditor((state) => state.moveSelectedContour)
  const beginTransform = useEditor((state) => state.beginTransform)
  const endTransform = useEditor((state) => state.endTransform)
  const draggingHandle = useRef(false)
  useEffect(
    () => () => {
      if (draggingHandle.current) endTransform()
    },
    [endTransform],
  )
  if (mode === 'object') return null
  const contour = shapeToFreeContour(panel)
  const thin = thinAxis(panel)
  const axes = ([0, 1, 2] as const).filter((axis) => axis !== thin)
  const point3 = (
    point: [number, number],
    thicknessPosition: number,
  ): [number, number, number] => {
    const result: [number, number, number] = [0, 0, 0]
    result[axes[0]] = point[0]
    result[axes[1]] = point[1]
    result[thin] = thicknessPosition
    return result
  }
  const selectedRing =
    selection?.panelId === panel.id
      ? [
          contour.faces[selection.faceIndex]?.outer,
          ...(contour.faces[selection.faceIndex]?.holes ?? []),
        ][selection.ringIndex + 1]
      : undefined
  const selectedPoint = selectedRing?.[selection?.edgeIndex ?? -1]
  const selectedNext =
    selectedRing && selection?.kind === 'face'
      ? selectedRing[(selection.edgeIndex + 1) % selectedRing.length]
      : undefined
  const handlePoint: [number, number] | undefined = selectedPoint
    ? selectedNext
      ? [
          (selectedPoint[0] + selectedNext[0]) / 2,
          (selectedPoint[1] + selectedNext[1]) / 2,
        ]
      : selectedPoint
    : undefined
  const handlePosition = handlePoint ? point3(handlePoint, 0) : undefined
  const panelRotation = new Euler(...panel.rotation)
  const worldHandlePosition = handlePosition
    ? (new Vector3(...handlePosition)
        .applyEuler(panelRotation)
        .add(new Vector3(...panel.position))
        .toArray() as [number, number, number])
    : undefined
  const selectionKey = selection
    ? `${selection.panelId}:${selection.faceIndex}:${selection.ringIndex}:${selection.edgeIndex}:${selection.kind}`
    : ''
  if (selectionKey !== lastSelectionKey.current) {
    lastSelectionKey.current = selectionKey
    lastHandlePosition.current = worldHandlePosition ?? null
  }
  const applyHandleMove = () => {
    if (!handleRef.current || !handlePoint) return
    const position = handleRef.current.position
    const current = position.toArray() as [number, number, number]
    const previous = lastHandlePosition.current ?? current
    const localDelta = new Vector3(
      current[0] - previous[0],
      current[1] - previous[1],
      current[2] - previous[2],
    ).applyQuaternion(new Quaternion().setFromEuler(panelRotation).invert())
    const delta: [number, number] = [
      localDelta.getComponent(axes[0]),
      localDelta.getComponent(axes[1]),
    ]
    if (delta.some((value) => Math.abs(value) > 1e-8)) {
      lastHandlePosition.current = current
      moveSelectedContour(delta)
    }
  }
  return (
    <>
      <group position={panel.position} rotation={panel.rotation}>
        {contour.faces.flatMap((face, faceIndex) =>
          [face.outer, ...face.holes].flatMap((ring, listIndex) =>
            ring.flatMap((point, edgeIndex) => {
              const ringIndex = listIndex - 1
              const selected =
                selection?.panelId === panel.id &&
                selection.faceIndex === faceIndex &&
                selection.ringIndex === ringIndex &&
                selection.edgeIndex === edgeIndex &&
                selection.kind === mode
              if (mode === 'face') {
                const next = ring[(edgeIndex + 1) % ring.length]
                return [
                  <SideFaceTarget
                    key={`${face.id}-${ringIndex}-${edgeIndex}-face`}
                    lowerA={point3(point, -panel.size[thin] / 2)}
                    lowerB={point3(next, -panel.size[thin] / 2)}
                    upperA={point3(point, panel.size[thin] / 2)}
                    upperB={point3(next, panel.size[thin] / 2)}
                    selected={selected}
                    onSelect={(event) => {
                      event.stopPropagation()
                      selectFace(panel.id, faceIndex, ringIndex, edgeIndex)
                    }}
                  />,
                ]
              }
              const selectVerticalEdge = (event: {
                stopPropagation: () => void
              }) => {
                event.stopPropagation()
                selectEdge(panel.id, faceIndex, ringIndex, edgeIndex)
              }
              return [
                <Line
                  key={`${face.id}-${ringIndex}-${edgeIndex}-edge`}
                  points={[
                    point3(point, -panel.size[thin] / 2),
                    point3(point, panel.size[thin] / 2),
                  ]}
                  color={selected ? '#fff36b' : '#ff8a3d'}
                  lineWidth={selected ? 7 : 4}
                  depthTest={false}
                  renderOrder={71}
                  onClick={selectVerticalEdge}
                />,
                <Line
                  key={`${face.id}-${ringIndex}-${edgeIndex}-edge-hit`}
                  points={[
                    point3(point, -panel.size[thin] / 2),
                    point3(point, panel.size[thin] / 2),
                  ]}
                  color="#ffffff"
                  lineWidth={18}
                  transparent
                  opacity={0.01}
                  depthTest={false}
                  renderOrder={72}
                  onPointerDown={selectVerticalEdge}
                  onClick={selectVerticalEdge}
                />,
              ]
            }),
          ),
        )}
      </group>
      {worldHandlePosition && (
        <>
          <group
            ref={handleRef}
            position={worldHandlePosition}
            rotation={panel.rotation}
          />
          <TransformControls
            object={handleRef}
            mode="translate"
            space="local"
            size={0.7}
            showX={axes.includes(0)}
            showY={axes.includes(1)}
            showZ={axes.includes(2)}
            onMouseDown={() => {
              draggingHandle.current = true
              beginTransform()
            }}
            onMouseUp={() => {
              draggingHandle.current = false
              endTransform()
            }}
            onObjectChange={applyHandleMove}
          />
        </>
      )}
    </>
  )
}

function PreviewShape({
  center,
  size,
  operation,
  shape = 'box',
  axis = 1,
  color,
}: {
  center: [number, number, number]
  size: [number, number, number]
  operation: 'add' | 'subtract'
  shape?: JointFeature['shape']
  axis?: 0 | 1 | 2
  color?: string
}) {
  const rotation: [number, number, number] =
    axis === 0
      ? [0, 0, Math.PI / 2]
      : axis === 2
        ? [Math.PI / 2, 0, 0]
        : [0, 0, 0]
  const radius = size[axis === 0 ? 1 : 0] / 2
  return (
    <mesh
      position={center}
      rotation={shape === 'cylinder' ? rotation : undefined}
      renderOrder={40}
    >
      {shape === 'cylinder' ? (
        <cylinderGeometry args={[radius, radius, size[axis], 24]} />
      ) : (
        <boxGeometry args={size} />
      )}
      <meshBasicMaterial
        color={color ?? (operation === 'subtract' ? '#ff3158' : '#3dff9a')}
        transparent
        opacity={0.58}
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
  )
}

function EditorReliefHole({ feature }: { feature: JointFeature }) {
  const axis = feature.axis ?? 1
  const rotation: [number, number, number] =
    axis === 0
      ? [0, 0, Math.PI / 2]
      : axis === 2
        ? [Math.PI / 2, 0, 0]
        : [0, 0, 0]
  const radius = feature.size[axis === 0 ? 1 : 0] / 2
  return (
    <mesh position={feature.center} rotation={rotation} renderOrder={3}>
      <cylinderGeometry args={[radius, radius, feature.size[axis], 16]} />
      <meshBasicMaterial color="#111419" depthWrite={false} />
    </mesh>
  )
}

function JointPreviewOverlay() {
  const preview = useEditor((state) => state.jointPreview)
  const panels = useEditor((state) => state.panels)
  if (!preview) return null
  return (
    <group>
      {preview.map((entry) => {
        const panel = panels.find((candidate) => candidate.id === entry.panelId)
        if (!panel) return null
        return (
          <group
            key={entry.panelId}
            position={panel.position}
            rotation={panel.rotation}
          >
            {entry.cuts.map((cut) => (
              <PreviewShape
                key={cut.id}
                center={cut.center}
                size={cut.size}
                operation="subtract"
                color={entry.color}
              />
            ))}
            {entry.features.map((feature) => (
              <PreviewShape
                key={feature.id}
                center={feature.center}
                size={feature.size}
                operation={feature.operation}
                shape={feature.shape}
                axis={feature.axis}
                color={entry.color}
              />
            ))}
          </group>
        )
      })}
    </group>
  )
}

function EditablePanel({
  panel,
  allPanels,
  snapModifier,
  coplanarModifier,
  rotationStep,
  translationStep,
  scaleStep,
  onGuidesChange,
  groupCenter,
}: {
  panel: ReturnType<typeof useEditor.getState>['panels'][number]
  allPanels: ReturnType<typeof useEditor.getState>['panels']
  snapModifier: boolean
  coplanarModifier: boolean
  rotationStep: number
  translationStep: number
  scaleStep: number
  onGuidesChange: (guides: AlignmentGuide[]) => void
  groupCenter?: [number, number, number]
}) {
  const selectedPanels = useEditor((state) => state.selectedPanels)
  const selectedGroupId = useEditor((state) => state.selectedGroupId)
  const materials = useEditor((state) => state.materials)
  const groups = useEditor((state) => state.groups)
  const colorMode = useEditor((state) => state.colorMode)
  const selectPanel = useEditor((state) => state.selectPanel)
  const resizePanel = useEditor((state) => state.resizePanel)
  const updatePanelShape = useEditor((state) => state.updatePanelShape)
  const movePanel = useEditor((state) => state.movePanel)
  const rotatePanel = useEditor((state) => state.rotatePanel)
  const transformMode = useEditor((state) => state.transformMode)
  const geometrySelectionMode = useEditor(
    (state) => state.geometrySelectionMode,
  )
  const transformConstraint = useEditor((state) => state.transformConstraint)
  const snapEnabled = useEditor((state) => state.snapEnabled)
  const beginTransform = useEditor((state) => state.beginTransform)
  const endTransform = useEditor((state) => state.endTransform)
  const setRotationPreview = useEditor((state) => state.setRotationPreview)
  const meshRef = useRef<Mesh>(null!)
  const [editingText, setEditingText] = useState(false)
  const [textDraft, setTextDraft] = useState(
    panel.shape?.type === 'text' ? panel.shape.text : '',
  )
  const cancelTextEdit = useRef(false)
  const dragOrigin = useRef<[number, number, number] | null>(null)
  const guideFrame = useRef<number | null>(null)
  const isOnlySelected =
    !selectedGroupId &&
    selectedPanels.length === 1 &&
    selectedPanels[0] === panel.id
  const geometryKey = panelGeometryKey(panel, allPanels)
  const geometry = useMemo(
    () => createCachedEvaluatedPanelGeometry(panel, allPanels),
    [geometryKey],
  )
  const textOutlineRings = useMemo(
    () =>
      panel.shape?.type === 'text' && panel.shape.outline
        ? textOutlineShapes(panel.shape.outline)
            .flatMap((shape) => [shape, ...shape.holes])
            .map((path) =>
              path
                .getPoints(24)
                .map((point) => [point.x, point.y] as [number, number]),
            )
        : [],
    [panel.shape, panel.size[2]],
  )
  const materialColor =
    materials.find((material) => material.id === panel.materialId)?.color ??
    '#d9a96c'
  const groupColor = groups.find((group) =>
    group.panelIds.includes(panel.id),
  )?.displayColor
  const displayColor =
    colorMode === 'object'
      ? (panel.displayColor ?? groupColor ?? materialColor)
      : materialColor
  const fastReliefs =
    (!panel.shape || panel.shape.type === 'rectangle') &&
    !panel.booleanModifiers.some((modifier) => modifier.enabled)
      ? panel.jointFeatures.filter(
          (feature) =>
            feature.operation === 'subtract' && feature.shape === 'cylinder',
        )
      : []

  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(
    () => () => {
      if (guideFrame.current !== null) cancelAnimationFrame(guideFrame.current)
    },
    [],
  )

  const scheduleDragGuides = (object: Mesh, candidates: PanelDefinition[]) => {
    if (guideFrame.current !== null) cancelAnimationFrame(guideFrame.current)
    const desired: [number, number, number] = [
      object.position.x,
      object.position.y,
      object.position.z,
    ]
    guideFrame.current = requestAnimationFrame(() => {
      guideFrame.current = null
      const origin = dragOrigin.current ?? desired
      const activeAxes = new Set(
        ([0, 1, 2] as const).filter(
          (axis) => Math.abs(desired[axis] - origin[axis]) > 0.01,
        ),
      )
      const distanceGuides = calculateDistanceGuides(
        panel,
        desired,
        candidates,
        activeAxes,
      )
      if (!snapEnabled) {
        onGuidesChange(distanceGuides)
        return
      }
      const snapDistance = surfaceSnapDistance(panel)
      const snapped = coplanarModifier
        ? snapPanelCoplanarPosition(panel, desired, candidates, snapDistance)
        : snapPanelPosition(panel, desired, candidates, snapDistance)
      onGuidesChange([
        ...calculateAlignmentGuides(
          panel,
          snapped,
          candidates,
          snapDistance * 2,
          snapDistance,
        ),
        ...distanceGuides,
      ])
    })
  }

  useEffect(() => {
    if (!editingText && panel.shape?.type === 'text')
      setTextDraft(panel.shape.text)
  }, [editingText, panel.shape])

  const commitTextEdit = async () => {
    setEditingText(false)
    if (
      cancelTextEdit.current ||
      panel.shape?.type !== 'text' ||
      textDraft === panel.shape.text
    ) {
      cancelTextEdit.current = false
      return
    }
    const nextShape = { ...panel.shape, text: textDraft }
    const outline = await createSystemTextOutline(
      nextShape.fontFamily,
      nextShape.text,
      nextShape.fontSize,
    )
    if (!outline) return
    updatePanelShape(panel.id, { ...nextShape, outline })
    resizePanel(panel.id, [outline.width, outline.height, panel.size[2]])
  }

  const commitTransform = () => {
    const mesh = meshRef.current
    if (!mesh) return
    if (transformMode === 'translate') {
      const desired: [number, number, number] = [
        mesh.position.x,
        mesh.position.y,
        mesh.position.z,
      ]
      const linked = linkedBooleanToolIds(panel.id, allPanels)
      const candidates = allPanels.filter(
        (candidate) =>
          candidate.id !== panel.id &&
          !candidate.hidden &&
          !linked.has(candidate.id),
      )
      const snapped = snapEnabled
        ? coplanarModifier
          ? snapPanelCoplanarPosition(panel, desired, candidates)
          : snapPanelPosition(panel, desired, candidates)
        : desired
      mesh.position.set(...snapped)
      movePanel(panel.id, snapped)
    } else if (transformMode === 'rotate') {
      rotatePanel(panel.id, [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z])
    } else {
      resizePanel(panel.id, [
        Math.max(0.5, panel.size[0] * Math.abs(mesh.scale.x)),
        Math.max(0.5, panel.size[1] * Math.abs(mesh.scale.y)),
        Math.max(0.5, panel.size[2] * Math.abs(mesh.scale.z)),
      ])
      mesh.scale.set(1, 1, 1)
    }
  }

  const mesh = (
    <mesh
      ref={meshRef}
      userData={{ panelId: panel.id }}
      position={
        groupCenter
          ? (panel.position.map((value, axis) => value - groupCenter[axis]) as [
              number,
              number,
              number,
            ])
          : panel.position
      }
      rotation={panel.rotation}
      onClick={(event) => {
        event.stopPropagation()
        if (sceneSelectionSuppressed()) return
        selectPanel(panel.id, event.ctrlKey || event.metaKey || event.shiftKey)
      }}
      onDoubleClick={(event) => {
        if (panel.shape?.type !== 'text') return
        event.stopPropagation()
        selectPanel(panel.id, false)
        setTextDraft(panel.shape.text)
        setEditingText(true)
      }}
      castShadow
      receiveShadow
    >
      <primitive object={geometry} attach="geometry" />
      <meshStandardMaterial
        color={selectedPanels.includes(panel.id) ? '#ff8a3d' : displayColor}
        roughness={0.63}
        metalness={0.02}
        transparent={
          panel.hidden ||
          (panel.shape?.type === 'text' && panel.shape.display === 'outline')
        }
        opacity={
          panel.hidden
            ? 0.28
            : panel.shape?.type === 'text' && panel.shape.display === 'outline'
              ? 0
              : 1
        }
        depthWrite={
          !panel.hidden &&
          !(panel.shape?.type === 'text' && panel.shape.display === 'outline')
        }
      />
      {fastReliefs.map((feature) => (
        <EditorReliefHole key={feature.id} feature={feature} />
      ))}
      {panel.shape?.type === 'text' &&
        panel.shape.display === 'outline' &&
        textOutlineRings.map((points, index) => (
          <ExtrudedTextContour
            key={index}
            points={points}
            thickness={panel.size[2]}
            color={selectedPanels.includes(panel.id) ? '#ffb07d' : displayColor}
          />
        ))}
      {editingText && panel.shape?.type === 'text' && (
        <Html
          center
          position={[0, 0, panel.size[2] / 2 + 1]}
          zIndexRange={[100, 0]}
        >
          <input
            className="canvas-text-editor"
            autoFocus
            aria-label="Text direkt bearbeiten"
            value={textDraft}
            onChange={(event) => setTextDraft(event.target.value)}
            onBlur={() => void commitTextEdit()}
            onPointerDown={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Enter') event.currentTarget.blur()
              if (event.key === 'Escape') {
                cancelTextEdit.current = true
                setTextDraft(
                  panel.shape!.type === 'text' ? panel.shape!.text : '',
                )
                event.currentTarget.blur()
              }
            }}
          />
        </Html>
      )}
    </mesh>
  )

  const lockedThicknessAxis = transformMode === 'scale' ? thinAxis(panel) : -1
  const showX =
    lockedThicknessAxis !== 0 &&
    (transformConstraint === 'free' || transformConstraint.includes('x'))
  const showY =
    lockedThicknessAxis !== 1 &&
    (transformConstraint === 'free' || transformConstraint.includes('y'))
  const showZ =
    lockedThicknessAxis !== 2 &&
    (transformConstraint === 'free' || transformConstraint.includes('z'))
  return (
    <>
      {mesh}
      {isOnlySelected && geometrySelectionMode === 'object' && (
        <TransformControls
          object={meshRef}
          mode={transformMode}
          space={transformMode === 'translate' ? 'world' : 'local'}
          showX={showX}
          showY={showY}
          showZ={showZ}
          translationSnap={snapModifier ? translationStep : null}
          rotationSnap={snapModifier ? (rotationStep * Math.PI) / 180 : null}
          scaleSnap={snapModifier ? scaleStep : null}
          onMouseDown={() => {
            beginSceneSelectionSuppression()
            beginTransform()
            dragOrigin.current = meshRef.current.position.toArray() as [
              number,
              number,
              number,
            ]
            setRotationPreview(null)
            onGuidesChange([])
          }}
          onMouseUp={() => {
            if (guideFrame.current !== null)
              cancelAnimationFrame(guideFrame.current)
            guideFrame.current = null
            dragOrigin.current = null
            commitTransform()
            finishSceneSelectionSuppression()
            setRotationPreview(null)
            endTransform()
            onGuidesChange([])
          }}
          onObjectChange={() => {
            const object = meshRef.current
            if (transformMode === 'rotate' && object)
              setRotationPreview({
                panelId: panel.id,
                rotation: [
                  object.rotation.x,
                  object.rotation.y,
                  object.rotation.z,
                ],
              })
            if (transformMode === 'translate' && object) {
              const linked = linkedBooleanToolIds(panel.id, allPanels)
              const candidates = allPanels.filter(
                (candidate) =>
                  candidate.id !== panel.id &&
                  !candidate.hidden &&
                  !linked.has(candidate.id),
              )
              scheduleDragGuides(object, candidates)
            }
          }}
        />
      )}
    </>
  )
}

function BoxModel({
  snapModifier,
  coplanarModifier,
  rotationStep,
  translationStep,
  scaleStep,
  onGuidesChange,
}: {
  snapModifier: boolean
  coplanarModifier: boolean
  rotationStep: number
  translationStep: number
  scaleStep: number
  onGuidesChange: (guides: AlignmentGuide[]) => void
}) {
  const panels = useEditor((state) => state.panels)
  const selectedPanels = useEditor((state) => state.selectedPanels)
  const selectedGroupId = useEditor((state) => state.selectedGroupId)
  const groups = useEditor((state) => state.groups)
  const transformSelectedGroup = useEditor(
    (state) => state.transformSelectedGroup,
  )
  const beginTransform = useEditor((state) => state.beginTransform)
  const endTransform = useEditor((state) => state.endTransform)
  const transformConstraint = useEditor((state) => state.transformConstraint)
  const transformMode = useEditor((state) => state.transformMode)
  const snapEnabled = useEditor((state) => state.snapEnabled)
  const groupRef = useRef<Group>(null!)
  const groupDragOrigin = useRef<[number, number, number] | null>(null)
  const groupGuideFrame = useRef<number | null>(null)
  const transformSelectionActive =
    Boolean(selectedGroupId) || selectedPanels.length > 1
  const groupedPanels = transformSelectionActive
    ? panels.filter((panel) => selectedPanels.includes(panel.id))
    : []
  const isVisible = (panelId: string) =>
    panels.find((panel) => panel.id === panelId)?.visible !== false &&
    !groups.some(
      (group) => group.visible === false && group.panelIds.includes(panelId),
    )
  const groupBounds = groupedPanels.reduce(
    (bounds, panel) => {
      const half = worldHalfExtents(panel)
      return {
        min: bounds.min.map((value, axis) =>
          Math.min(value, panel.position[axis] - half[axis]),
        ) as [number, number, number],
        max: bounds.max.map((value, axis) =>
          Math.max(value, panel.position[axis] + half[axis]),
        ) as [number, number, number],
      }
    },
    {
      min: [Infinity, Infinity, Infinity] as [number, number, number],
      max: [-Infinity, -Infinity, -Infinity] as [number, number, number],
    },
  )
  const center: [number, number, number] = groupedPanels.length
    ? (groupBounds.min.map(
        (value, axis) => (value + groupBounds.max[axis]) / 2,
      ) as [number, number, number])
    : [0, 0, 0]
  const groupProxy: PanelDefinition = {
    id: '__selected-group__',
    label: 'Baugruppe',
    size: groupedPanels.length
      ? (groupBounds.max.map(
          (value, axis) => value - groupBounds.min[axis],
        ) as [number, number, number])
      : [1, 1, 1],
    position: center,
    rotation: [0, 0, 0],
    cuts: [],
    booleanModifiers: [],
    jointFeatures: [],
    hidden: false,
    visible: true,
  }
  const guideCandidates = panels.filter(
    (panel) =>
      !selectedPanels.includes(panel.id) &&
      !panel.hidden &&
      isVisible(panel.id),
  )
  const showX =
      transformConstraint === 'free' || transformConstraint.includes('x'),
    showY = transformConstraint === 'free' || transformConstraint.includes('y'),
    showZ = transformConstraint === 'free' || transformConstraint.includes('z')
  useEffect(
    () => () => {
      if (groupGuideFrame.current !== null)
        cancelAnimationFrame(groupGuideFrame.current)
    },
    [],
  )

  const scheduleGroupGuides = (object: Group) => {
    if (groupGuideFrame.current !== null)
      cancelAnimationFrame(groupGuideFrame.current)
    const desired = object.position.toArray() as [number, number, number]
    groupGuideFrame.current = requestAnimationFrame(() => {
      groupGuideFrame.current = null
      const origin = groupDragOrigin.current ?? desired
      const activeAxes = new Set(
        ([0, 1, 2] as const).filter(
          (axis) => Math.abs(desired[axis] - origin[axis]) > 0.01,
        ),
      )
      const distanceGuides = calculateDistanceGuides(
        groupProxy,
        desired,
        guideCandidates,
        activeAxes,
      )
      if (!snapEnabled) {
        onGuidesChange(distanceGuides)
        return
      }
      const snapDistance = surfaceSnapDistance(groupProxy)
      const snapped = coplanarModifier
        ? snapPanelCoplanarPosition(
            groupProxy,
            desired,
            guideCandidates,
            snapDistance,
          )
        : snapPanelPosition(groupProxy, desired, guideCandidates, snapDistance)
      onGuidesChange([
        ...calculateAlignmentGuides(
          groupProxy,
          snapped,
          guideCandidates,
          snapDistance * 2,
          snapDistance,
        ),
        ...distanceGuides,
      ])
    })
  }

  return (
    <group>
      {panels
        .filter(
          (panel) =>
            isVisible(panel.id) &&
            (!panel.hidden || selectedPanels.includes(panel.id)) &&
            (!transformSelectionActive || !selectedPanels.includes(panel.id)),
        )
        .map((panel) => (
          <EditablePanel
            key={panel.id}
            panel={panel}
            allPanels={panels}
            snapModifier={snapModifier}
            coplanarModifier={coplanarModifier}
            rotationStep={rotationStep}
            translationStep={translationStep}
            scaleStep={scaleStep}
            onGuidesChange={onGuidesChange}
          />
        ))}
      {selectedPanels.length === 1 &&
        (() => {
          const panel = panels.find(
            (candidate) => candidate.id === selectedPanels[0],
          )
          return panel ? <ContourEditorOverlay panel={panel} /> : null
        })()}
      {transformSelectionActive && (
        <group ref={groupRef} position={center}>
          {groupedPanels
            .filter(
              (panel) =>
                isVisible(panel.id) &&
                (!panel.hidden || selectedPanels.includes(panel.id)),
            )
            .map((panel) => (
              <EditablePanel
                key={panel.id}
                panel={panel}
                allPanels={panels}
                groupCenter={center}
                snapModifier={snapModifier}
                coplanarModifier={coplanarModifier}
                rotationStep={rotationStep}
                translationStep={translationStep}
                scaleStep={scaleStep}
                onGuidesChange={onGuidesChange}
              />
            ))}
        </group>
      )}
      {transformSelectionActive && groupedPanels.length > 0 && (
        <TransformControls
          object={groupRef}
          mode={transformMode}
          space={transformMode === 'translate' ? 'world' : 'local'}
          showX={showX}
          showY={showY}
          showZ={showZ}
          translationSnap={snapModifier ? translationStep : null}
          rotationSnap={snapModifier ? (rotationStep * Math.PI) / 180 : null}
          scaleSnap={snapModifier ? scaleStep : null}
          onMouseDown={() => {
            beginSceneSelectionSuppression()
            beginTransform()
            groupDragOrigin.current = groupRef.current.position.toArray() as [
              number,
              number,
              number,
            ]
            onGuidesChange([])
          }}
          onObjectChange={() => {
            const object = groupRef.current
            if (!object) return
            if (transformMode === 'scale') {
              const values = [object.scale.x, object.scale.y, object.scale.z]
              const uniform = values.reduce(
                (chosen, value) =>
                  Math.abs(value - 1) > Math.abs(chosen - 1) ? value : chosen,
                1,
              )
              if (values.some((value) => Math.abs(value - uniform) > 1e-8))
                object.scale.setScalar(Math.max(0.01, uniform))
              onGuidesChange([])
              return
            }
            if (transformMode !== 'translate') return onGuidesChange([])
            scheduleGroupGuides(object)
          }}
          onMouseUp={() => {
            if (groupGuideFrame.current !== null)
              cancelAnimationFrame(groupGuideFrame.current)
            groupGuideFrame.current = null
            groupDragOrigin.current = null
            const object = groupRef.current
            const desired = object.position.toArray() as [
              number,
              number,
              number,
            ]
            const finalPosition =
              transformMode === 'translate' && snapEnabled
                ? coplanarModifier
                  ? snapPanelCoplanarPosition(
                      groupProxy,
                      desired,
                      guideCandidates,
                    )
                  : snapPanelPosition(groupProxy, desired, guideCandidates)
                : desired
            const uniformScale =
              transformMode === 'scale' ? Math.max(0.01, object.scale.x) : 1
            transformSelectedGroup(
              center,
              finalPosition,
              transformMode === 'rotate'
                ? [object.rotation.x, object.rotation.y, object.rotation.z]
                : [0, 0, 0],
              uniformScale,
            )
            finishSceneSelectionSuppression()
            onGuidesChange([])
            endTransform()
          }}
        />
      )}
    </group>
  )
}

const guideColors = ['#ef5a61', '#6fcf72', '#4da3ff']

type SelectionBridge = {
  camera: Camera
  scene: Scene
  raycaster: Raycaster
  canvas: HTMLCanvasElement
}
function SelectionBridgeProvider({
  bridge,
}: {
  bridge: React.MutableRefObject<SelectionBridge | null>
}) {
  const { camera, scene, raycaster, gl } = useThree()
  useEffect(() => {
    bridge.current = { camera, scene, raycaster, canvas: gl.domElement }
    return () => {
      bridge.current = null
    }
  }, [bridge, camera, gl, raycaster, scene])
  return null
}

const panelIdOf = (object: Object3D | null): string | null => {
  let current = object
  while (current) {
    if (typeof current.userData.panelId === 'string')
      return current.userData.panelId
    current = current.parent
  }
  return null
}

function AlignmentGuides({ guides }: { guides: AlignmentGuide[] }) {
  return (
    <group>
      {guides.map((guide) => (
        <group
          key={`${guide.axis}-${guide.label}-${guide.points.flat().join(',')}`}
        >
          <Line
            points={guide.points}
            color={guideColors[guide.axis]}
            lineWidth={
              guide.kind === 'distance' ? 2 : guide.snapped ? 2.5 : 1.25
            }
            dashed={guide.kind !== 'distance' && !guide.snapped}
            dashSize={4}
            gapSize={3}
            depthTest={false}
            renderOrder={50}
          />
          <Html position={guide.position} center zIndexRange={[60, 0]}>
            <div
              className={`guide-label${guide.snapped ? ' snapped' : ''}${guide.kind === 'distance' ? ' distance' : ''}`}
              style={
                { '--guide-color': guideColors[guide.axis] } as CSSProperties
              }
            >
              {guide.label}
            </div>
          </Html>
        </group>
      ))}
    </group>
  )
}

export function Viewport() {
  const selectPanel = useEditor((state) => state.selectPanel)
  const selectPanels = useEditor((state) => state.selectPanels)
  const removeSelected = useEditor((state) => state.removeSelected)
  const setTransformMode = useEditor((state) => state.setTransformMode)
  const transformMode = useEditor((state) => state.transformMode)
  const transformConstraint = useEditor((state) => state.transformConstraint)
  const setTransformConstraint = useEditor(
    (state) => state.setTransformConstraint,
  )
  const rotationStep = useEditor((state) => state.rotationStep)
  const translationStep = useEditor((state) => state.translationStep)
  const scaleStep = useEditor((state) => state.scaleStep)
  const transformGridEnabled = useEditor((state) => state.transformGridEnabled)
  const undo = useEditor((state) => state.undo)
  const redo = useEditor((state) => state.redo)
  const [snapModifier, setSnapModifier] = useState(false)
  const [coplanarModifier, setCoplanarModifier] = useState(false)
  const [alignmentGuides, setAlignmentGuides] = useState<AlignmentGuide[]>([])
  const [rubberbandActive, setRubberbandActive] = useState(false)
  const viewportRef = useRef<HTMLDivElement>(null)
  const rubberbandRef = useRef<HTMLDivElement>(null)
  const selectionBridge = useRef<SelectionBridge | null>(null)
  const rubberband = useRef<{
    pointerId: number
    startX: number
    startY: number
    x: number
    y: number
    additive: boolean
  } | null>(null)
  const viewGesture = useRef<{
    pointerId: number
    startX: number
    startY: number
    moved: boolean
  } | null>(null)

  const drawRubberband = (
    startX: number,
    startY: number,
    x: number,
    y: number,
  ) => {
    const viewport = viewportRef.current?.getBoundingClientRect()
    const element = rubberbandRef.current
    if (!viewport || !element) return
    element.style.left = `${Math.min(startX, x) - viewport.left}px`
    element.style.top = `${Math.min(startY, y) - viewport.top}px`
    element.style.width = `${Math.abs(x - startX)}px`
    element.style.height = `${Math.abs(y - startY)}px`
    element.classList.toggle('crossing', x < startX)
  }
  const beginRubberband = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (
      !event.shiftKey ||
      event.button !== 0 ||
      !(event.target instanceof HTMLCanvasElement)
    )
      return
    const bridge = selectionBridge.current
    if (!bridge) return
    const rect = bridge.canvas.getBoundingClientRect()
    const pointer = new Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      (-(event.clientY - rect.top) / rect.height) * 2 + 1,
    )
    bridge.raycaster.setFromCamera(pointer, bridge.camera)
    if (
      bridge.raycaster
        .intersectObjects(bridge.scene.children, true)
        .some((hit) => panelIdOf(hit.object))
    )
      return
    event.preventDefault()
    event.stopPropagation()
    rubberband.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      additive: event.ctrlKey || event.metaKey,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setRubberbandActive(true)
    requestAnimationFrame(() =>
      drawRubberband(
        event.clientX,
        event.clientY,
        event.clientX,
        event.clientY,
      ),
    )
  }
  const moveRubberband = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = rubberband.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    drag.x = event.clientX
    drag.y = event.clientY
    drawRubberband(drag.startX, drag.startY, drag.x, drag.y)
  }
  const endRubberband = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = rubberband.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    const bridge = selectionBridge.current
    const canvasRect = bridge?.canvas.getBoundingClientRect()
    if (
      bridge &&
      canvasRect &&
      Math.hypot(drag.x - drag.startX, drag.y - drag.startY) >= 4
    ) {
      const left = Math.min(drag.startX, drag.x),
        right = Math.max(drag.startX, drag.x),
        top = Math.min(drag.startY, drag.y),
        bottom = Math.max(drag.startY, drag.y)
      const crossing = drag.x < drag.startX
      const state = useEditor.getState()
      const hiddenByGroup = new Set(
        state.groups
          .filter((group) => group.visible === false)
          .flatMap((group) => group.panelIds),
      )
      const ids = state.panels
        .filter(
          (panel) =>
            panel.visible !== false &&
            !hiddenByGroup.has(panel.id) &&
            !panel.hidden,
        )
        .filter((panel) => {
          const half = worldHalfExtents(panel)
          const projected = [-1, 1].flatMap((sx) =>
            [-1, 1].flatMap((sy) =>
              [-1, 1].map((sz) => {
                const point = new Vector3(
                  panel.position[0] + sx * half[0],
                  panel.position[1] + sy * half[1],
                  panel.position[2] + sz * half[2],
                ).project(bridge.camera)
                return {
                  x: canvasRect.left + ((point.x + 1) * canvasRect.width) / 2,
                  y: canvasRect.top + ((1 - point.y) * canvasRect.height) / 2,
                  z: point.z,
                }
              }),
            ),
          )
          if (projected.every((point) => point.z < -1 || point.z > 1))
            return false
          const objectLeft = Math.min(...projected.map((point) => point.x)),
            objectRight = Math.max(...projected.map((point) => point.x))
          const objectTop = Math.min(...projected.map((point) => point.y)),
            objectBottom = Math.max(...projected.map((point) => point.y))
          return crossing
            ? objectRight >= left &&
                objectLeft <= right &&
                objectBottom >= top &&
                objectTop <= bottom
            : objectLeft >= left &&
                objectRight <= right &&
                objectTop >= top &&
                objectBottom <= bottom
        })
        .map((panel) => panel.id)
      selectPanels(ids, drag.additive)
    } else if (!drag.additive) selectPanels([])
    rubberband.current = null
    setRubberbandActive(false)
  }

  const beginViewportPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    beginRubberband(event)
    if (rubberband.current || !(event.target instanceof HTMLCanvasElement))
      return
    viewGesture.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    }
  }
  const moveViewportPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    moveRubberband(event)
    const gesture = viewGesture.current
    if (!gesture || gesture.pointerId !== event.pointerId || gesture.moved)
      return
    if (
      Math.hypot(
        event.clientX - gesture.startX,
        event.clientY - gesture.startY,
      ) < 4
    )
      return
    gesture.moved = true
    beginSceneSelectionSuppression()
  }
  const endViewportPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    endRubberband(event)
    const gesture = viewGesture.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    if (gesture.moved) finishSceneSelectionSuppression()
    viewGesture.current = null
  }
  const cancelViewportPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    endRubberband(event)
    if (viewGesture.current?.pointerId === event.pointerId)
      viewGesture.current = null
    suppressSceneSelectionUntil = 0
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Control') setSnapModifier(true)
      if (event.key === 'Shift') setCoplanarModifier(true)
      if (
        (event.key === 'Delete' || event.key === 'Backspace') &&
        !(event.target instanceof HTMLInputElement)
      )
        removeSelected()
      if (event.target instanceof HTMLInputElement) return
      const key = event.key.toLowerCase()
      if ((event.ctrlKey || event.metaKey) && key === 'z') {
        event.preventDefault()
        event.shiftKey ? redo() : undo()
        return
      }
      if ((event.ctrlKey || event.metaKey) && key === 's') {
        event.preventDefault()
        return
      }
      if (key === 'g') {
        setTransformMode('translate')
        setTransformConstraint('free')
      }
      if (key === 'r') {
        setTransformMode('rotate')
        setTransformConstraint('free')
      }
      if (key === 's') {
        setTransformMode('scale')
        setTransformConstraint('free')
      }
      if (key === 'escape') setTransformConstraint('free')
      if (key === 'x' || key === 'y' || key === 'z') {
        const plane = { x: 'yz', y: 'xz', z: 'xy' } as const
        const next = event.shiftKey ? plane[key] : key
        setTransformConstraint(transformConstraint === next ? 'free' : next)
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Control') setSnapModifier(false)
      if (event.key === 'Shift') setCoplanarModifier(false)
    }
    const onBlur = () => {
      suppressSceneSelectionUntil = 0
      setSnapModifier(false)
      setCoplanarModifier(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [
    redo,
    removeSelected,
    setTransformConstraint,
    setTransformMode,
    transformConstraint,
    undo,
  ])

  return (
    <div
      ref={viewportRef}
      className={`viewport${rubberbandActive ? ' rubberband-active' : ''}`}
      onPointerDownCapture={beginViewportPointer}
      onPointerMoveCapture={moveViewportPointer}
      onPointerUpCapture={endViewportPointer}
      onPointerCancelCapture={cancelViewportPointer}
    >
      <Canvas
        shadows
        dpr={[1, 2]}
        frameloop="demand"
        onPointerMissed={() => {
          if (!sceneSelectionSuppressed()) selectPanel(null)
        }}
      >
        <SelectionBridgeProvider bridge={selectionBridge} />
        <color attach="background" args={['#171a1f']} />
        <PerspectiveCamera
          makeDefault
          position={[260, 210, 300]}
          fov={42}
          near={0.1}
          far={5000}
        />
        <ambientLight intensity={0.8} />
        <directionalLight
          position={[180, 260, 140]}
          intensity={2.4}
          castShadow
        />
        <BoxModel
          snapModifier={snapModifier || transformGridEnabled}
          coplanarModifier={coplanarModifier}
          rotationStep={rotationStep}
          translationStep={translationStep}
          scaleStep={scaleStep}
          onGuidesChange={setAlignmentGuides}
        />
        <JointPreviewOverlay />
        <AlignmentGuides guides={alignmentGuides} />
        <Grid
          position={[0, -72, 0]}
          args={[1200, 1200]}
          cellSize={10}
          sectionSize={100}
          cellColor="#343941"
          sectionColor="#59616d"
          fadeDistance={900}
          infiniteGrid
        />
        <OrbitControls
          makeDefault
          enabled={!rubberbandActive}
          enableDamping
          dampingFactor={0.08}
          screenSpacePanning
        />
        <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
          <GizmoViewport
            axisColors={['#ef5a61', '#6fcf72', '#4da3ff']}
            labelColor="white"
          />
        </GizmoHelper>
        <Environment preset="warehouse" environmentIntensity={0.35} />
      </Canvas>
      <div ref={rubberbandRef} className="viewport-rubberband" />
      <div className="viewport-hint">
        <span>
          Shift+Ziehen: Rahmenauswahl · Ctrl+Ziehen: Ansicht verschieben
        </span>
        <span>G/R/S Transformieren</span>
        <span>
          {transformConstraint === 'free'
            ? 'X/Y/Z Achse wählen'
            : `Fixiert: ${transformConstraint.toUpperCase()}`}
        </span>
        <span>
          {transformGridEnabled ? 'Raster aktiv' : 'Ctrl-Raster'}:{' '}
          {transformMode === 'translate'
            ? `${translationStep} mm`
            : transformMode === 'rotate'
              ? `${rotationStep}°`
              : `${Number((scaleStep * 100).toFixed(1))}%`}
        </span>
      </div>
    </div>
  )
}
