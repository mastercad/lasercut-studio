import { create } from 'zustand'
import { Euler, Quaternion, Vector3 } from 'three'
import {
  createBoxPanels,
  defaultBox,
  defaultMaterials,
  thinAxis,
  type BooleanOperation,
  type BoxDimensions,
  type ContourFace,
  type CrossJointDefinition,
  type CutOperation,
  type FingerJointDefinition,
  type FingerStyle,
  type FitPreset,
  type JointFeature,
  type LaserTextDefinition,
  type MaterialDefinition,
  type PanelDefinition,
  type PanelShape,
} from '../model/box'
import { bundledFontFamily, missingFontFamilies } from '../model/fonts'
import { snapPanelPosition, worldHalfExtents } from '../model/snapping'
import { localAxisForWorld, worldThinAxis } from '../model/orientation'
import { linkedBooleanToolIds } from '../model/booleanGraph'
import { buildFingerJoint } from '../model/fingerJoints'
import { buildCrossJoint } from '../model/crossJoints'
import {
  createDefaultExportLayers,
  createDefaultLaserPresets,
  createDefaultProcessingProfiles,
  createDefaultProcessingRecipes,
  defaultLaserCutters,
  type ExportLayerDefinition,
  type LaserCutterDefinition,
  type LaserPreset,
  type ProcessingProfile,
  type ProcessingRecipe,
} from '../model/export'
import { shapeToFreeContour } from '../model/contours'
import { pruneBooleanGeometryCache } from '../model/panelGeometry'

type Workspace = 'model' | 'unfold'
export type ProjectGroup = {
  id: string
  name: string
  panelIds: string[]
  visible?: boolean
  displayColor?: string
}
export type TransformMode = 'translate' | 'rotate' | 'scale'
export type TransformConstraint = 'free' | 'x' | 'y' | 'z' | 'xy' | 'xz' | 'yz'
export type GeometrySelectionMode = 'object' | 'face' | 'edge'
export type ContourSelection = {
  panelId: string
  faceIndex: number
  ringIndex: number
  edgeIndex: number
  kind: 'face' | 'edge'
} | null

let nextPanelNumber = 1
const operationId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

type HistorySnapshot = Pick<
  EditorState,
  | 'box'
  | 'panels'
  | 'materials'
  | 'groups'
  | 'selectedGroupId'
  | 'selectedPanels'
  | 'fingerJoints'
  | 'crossJoints'
  | 'laserTexts'
  | 'processingProfiles'
  | 'processingRecipes'
>
const historyPast: HistorySnapshot[] = []
const historyFuture: HistorySnapshot[] = []
let historyRestoring = false
let transformSnapshot: HistorySnapshot | null = null
const snapshotOf = (state: EditorState): HistorySnapshot => ({
  box: state.box,
  panels: state.panels,
  materials: state.materials,
  groups: state.groups,
  selectedGroupId: state.selectedGroupId,
  selectedPanels: state.selectedPanels,
  fingerJoints: state.fingerJoints,
  crossJoints: state.crossJoints,
  laserTexts: state.laserTexts,
  processingProfiles: state.processingProfiles,
  processingRecipes: state.processingRecipes,
})

function rebuildConnections(
  panels: PanelDefinition[],
  fingerJoints: FingerJointDefinition[],
  crossJoints: CrossJointDefinition[],
  affectedPanelIds?: Set<string>,
) {
  const fingerToBuild = affectedPanelIds
    ? fingerJoints.filter(
        (joint) =>
          affectedPanelIds.has(joint.firstPanelId) ||
          affectedPanelIds.has(joint.secondPanelId),
      )
    : fingerJoints
  const crossToBuild = affectedPanelIds
    ? crossJoints.filter(
        (joint) =>
          affectedPanelIds.has(joint.firstPanelId) ||
          affectedPanelIds.has(joint.secondPanelId),
      )
    : crossJoints
  const rebuiltIds = new Set(
    [...fingerToBuild, ...crossToBuild].map((joint) => joint.id),
  )
  if (!fingerJoints.length && !crossJoints.length) {
    const containsOrphanedGeometry = panels.some(
      (panel) =>
        panel.jointFeatures.length || panel.cuts.some((cut) => cut.jointId),
    )
    return {
      panels: containsOrphanedGeometry
        ? panels.map((panel) => ({
            ...panel,
            jointFeatures: [],
            cuts: panel.cuts.filter((cut) => !cut.jointId),
          }))
        : panels,
      fingerJoints,
      crossJoints,
      failed: [] as string[],
    }
  }
  // A full rebuild discards all derived connection geometry. Interactive
  // transforms pass affectedPanelIds so unrelated joints retain both their
  // feature IDs and cached 3D geometry.
  let rebuiltPanels: PanelDefinition[] = panels.map((panel) => ({
    ...panel,
    jointFeatures: affectedPanelIds
      ? panel.jointFeatures.filter(
          (feature) => !rebuiltIds.has(feature.jointId),
        )
      : ([] as JointFeature[]),
    cuts: affectedPanelIds
      ? panel.cuts.filter((cut) => !cut.jointId || !rebuiltIds.has(cut.jointId))
      : panel.cuts.filter((cut) => !cut.jointId),
  }))
  const rebuiltFingerJoints: FingerJointDefinition[] = affectedPanelIds
    ? fingerJoints.filter((joint) => !rebuiltIds.has(joint.id))
    : []
  const rebuiltCrossJoints: CrossJointDefinition[] = affectedPanelIds
    ? crossJoints.filter((joint) => !rebuiltIds.has(joint.id))
    : []
  const failed: string[] = []

  for (const joint of fingerToBuild) {
    const first = rebuiltPanels.find((panel) => panel.id === joint.firstPanelId)
    const second = rebuiltPanels.find(
      (panel) => panel.id === joint.secondPanelId,
    )
    if (!first || !second) {
      failed.push(joint.id)
      continue
    }
    const built = buildFingerJoint(
      first,
      second,
      {
        fingerWidth: joint.fingerWidth,
        fit: joint.fit,
        clearance: joint.clearance,
        style: joint.style,
        reliefDiameter: joint.reliefDiameter,
      },
      joint.id,
    )
    if ('error' in built) {
      failed.push(joint.id)
      continue
    }
    rebuiltPanels = rebuiltPanels.map((panel) =>
      panel.id === first.id
        ? {
            ...panel,
            jointFeatures: [...panel.jointFeatures, ...built.firstFeatures],
          }
        : panel.id === second.id
          ? {
              ...panel,
              jointFeatures: [...panel.jointFeatures, ...built.secondFeatures],
            }
          : panel,
    )
    rebuiltFingerJoints.push(built.definition)
  }
  for (const joint of crossToBuild) {
    const first = rebuiltPanels.find((panel) => panel.id === joint.firstPanelId)
    const second = rebuiltPanels.find(
      (panel) => panel.id === joint.secondPanelId,
    )
    if (!first || !second) {
      failed.push(joint.id)
      continue
    }
    const built = buildCrossJoint(
      first,
      second,
      {
        ratio: joint.ratio,
        fit: joint.fit,
        clearance: joint.clearance,
        firstFromHigh: joint.firstFromHigh,
      },
      joint.id,
    )
    if ('error' in built) {
      failed.push(joint.id)
      continue
    }
    rebuiltPanels = rebuiltPanels.map((panel) =>
      panel.id === first.id
        ? {
            ...panel,
            cuts: [...panel.cuts, built.firstCut],
            jointFeatures: [...panel.jointFeatures, ...built.firstFeatures],
          }
        : panel.id === second.id
          ? {
              ...panel,
              cuts: [...panel.cuts, built.secondCut],
              jointFeatures: [...panel.jointFeatures, ...built.secondFeatures],
            }
          : panel,
    )
    rebuiltCrossJoints.push(built.definition)
  }
  return {
    panels: rebuiltPanels,
    fingerJoints: rebuiltFingerJoints,
    crossJoints: rebuiltCrossJoints,
    failed,
  }
}

function applyMaterialThickness(
  panels: PanelDefinition[],
  affected: Set<string>,
  thickness: number,
) {
  const bounds = panels.reduce(
    (current, panel) => {
      const half = worldHalfExtents(panel)
      for (const axis of [0, 1, 2] as const) {
        current.min[axis] = Math.min(
          current.min[axis],
          panel.position[axis] - half[axis],
        )
        current.max[axis] = Math.max(
          current.max[axis],
          panel.position[axis] + half[axis],
        )
      }
      return current
    },
    {
      min: [Infinity, Infinity, Infinity] as [number, number, number],
      max: [-Infinity, -Infinity, -Infinity] as [number, number, number],
    },
  )
  const assemblyCenter = bounds.min.map(
    (value, axis) => (value + bounds.max[axis]) / 2,
  ) as [number, number, number]

  const resized = panels.map((panel) => {
    if (!affected.has(panel.id)) return panel
    const localThin = thinAxis(panel)
    const worldThin = worldThinAxis(panel)
    const previousThickness = panel.size[localThin]
    if (previousThickness === thickness) return panel
    const outwardDirection = Math.sign(
      panel.position[worldThin] - assemblyCenter[worldThin],
    )
    const size: [number, number, number] = [...panel.size]
    const position: [number, number, number] = [...panel.position]
    size[localThin] = thickness
    // Preserve the face farther away from the assembly center. The center of
    // the plate moves inward by half the thickness delta, so fixed external
    // dimensions never grow when a material becomes thicker.
    position[worldThin] -=
      (outwardDirection * (thickness - previousThickness)) / 2
    return { ...panel, size, position }
  })

  // Propagate every moved inner material face to panels that previously ended
  // exactly on that face. This preserves the construction topology: adjacent
  // inset panels are shortened/extended at the shared boundary instead of
  // being overlapped or leaving a gap.
  const result = [...resized]
  const mutableIds = new Set(
    resized
      .filter((panel, index) => panel !== panels[index])
      .map((panel) => panel.id),
  )
  for (const changed of panels.filter((panel) => affected.has(panel.id))) {
    const worldAxis = worldThinAxis(changed)
    const localThin = thinAxis(changed)
    const oldThickness = changed.size[localThin]
    const outward = Math.sign(
      changed.position[worldAxis] - assemblyCenter[worldAxis],
    )
    if (!outward || oldThickness === thickness) continue
    const oldInnerFace =
      changed.position[worldAxis] - (outward * oldThickness) / 2
    const newInnerFace = oldInnerFace - outward * (thickness - oldThickness)
    const changedHalf = worldHalfExtents(changed)

    for (const originalNeighbor of panels) {
      if (originalNeighbor.id === changed.id) continue
      const neighborAxis = localAxisForWorld(originalNeighbor, worldAxis)
      if (neighborAxis === thinAxis(originalNeighbor)) continue
      const neighborHalf = worldHalfExtents(originalNeighbor)
      const neighborFace =
        originalNeighbor.position[worldAxis] + outward * neighborHalf[worldAxis]
      if (Math.abs(neighborFace - oldInnerFace) > 0.05) continue
      const sharesBoundary = ([0, 1, 2] as const)
        .filter((axis) => axis !== worldAxis)
        .every((axis) => {
          const changedMin = changed.position[axis] - changedHalf[axis]
          const changedMax = changed.position[axis] + changedHalf[axis]
          const neighborMin =
            originalNeighbor.position[axis] - neighborHalf[axis]
          const neighborMax =
            originalNeighbor.position[axis] + neighborHalf[axis]
          return (
            Math.min(changedMax, neighborMax) -
              Math.max(changedMin, neighborMin) >=
            -0.05
          )
        })
      if (!sharesBoundary) continue

      const neighborIndex = result.findIndex(
        (panel) => panel.id === originalNeighbor.id,
      )
      let neighbor = result[neighborIndex]
      if (!mutableIds.has(neighbor.id)) {
        neighbor = {
          ...neighbor,
          size: [...neighbor.size] as [number, number, number],
          position: [...neighbor.position] as [number, number, number],
        }
        result[neighborIndex] = neighbor
        mutableIds.add(neighbor.id)
      }
      const boundaryDelta = newInnerFace - oldInnerFace
      neighbor.position[worldAxis] += boundaryDelta / 2
      neighbor.size[neighborAxis] = Math.max(
        0.1,
        neighbor.size[neighborAxis] + outward * boundaryDelta,
      )
    }
  }
  return result
}

export type EditorState = {
  box: BoxDimensions
  panels: PanelDefinition[]
  materials: MaterialDefinition[]
  fingerJoints: FingerJointDefinition[]
  crossJoints: CrossJointDefinition[]
  laserTexts: LaserTextDefinition[]
  missingFonts: string[]
  exportLayers: ExportLayerDefinition[]
  laserCutters: LaserCutterDefinition[]
  laserPresets: LaserPreset[]
  processingProfiles: ProcessingProfile[]
  processingRecipes: ProcessingRecipe[]
  activeLaserId: string
  groups: ProjectGroup[]
  selectedGroupId: string | null
  selectedPanels: PanelDefinition['id'][]
  selectedTextId: string | null
  workspace: Workspace
  transformMode: TransformMode
  transformConstraint: TransformConstraint
  geometrySelectionMode: GeometrySelectionMode
  contourSelection: ContourSelection
  snapEnabled: boolean
  rotationStep: number
  translationStep: number
  scaleStep: number
  transformGridEnabled: boolean
  colorMode: 'material' | 'object'
  operationMessage: string | null
  canUndo: boolean
  canRedo: boolean
  rotationPreview: {
    panelId: string
    rotation: [number, number, number]
  } | null
  jointPreview:
    | {
        panelId: string
        cuts: CutOperation[]
        features: JointFeature[]
        color?: string
      }[]
    | null
  setDimension: (key: keyof BoxDimensions, value: number) => void
  selectPanel: (id: PanelDefinition['id'] | null, additive?: boolean) => void
  selectPanels: (ids: PanelDefinition['id'][], additive?: boolean) => void
  selectLaserText: (id: string | null) => void
  selectGroup: (id: string | null) => void
  togglePanelVisibility: (id: string) => void
  toggleGroupVisibility: (id: string) => void
  createGroup: () => void
  duplicateGroup: (id: string) => void
  deleteGroup: (id: string) => void
  renameGroup: (id: string, name: string) => void
  renamePanel: (id: PanelDefinition['id'], name: string) => void
  assignSelectionToGroup: (id: string) => void
  moveSelectedBy: (delta: [number, number, number]) => void
  transformSelectedGroup: (
    center: [number, number, number],
    position: [number, number, number],
    rotation: [number, number, number],
    scale: number,
  ) => void
  removeSelected: () => void
  duplicateSelected: () => void
  addPanel: () => void
  addShape: (shape: PanelShape['type']) => void
  importSvgObjects: (
    name: string,
    objects: {
      name: string
      groupName: string
      materialId: string
      faces: ContourFace[]
    }[],
  ) => void
  updatePanelShape: (id: string, shape: PanelShape) => void
  setGeometrySelectionMode: (mode: GeometrySelectionMode) => void
  convertPanelToFreeContour: (id: string, keepCopy?: boolean) => void
  selectContourFace: (
    panelId: string,
    faceIndex: number,
    ringIndex: number,
    edgeIndex: number,
  ) => void
  selectContourEdge: (
    panelId: string,
    faceIndex: number,
    ringIndex: number,
    edgeIndex: number,
  ) => void
  moveSelectedContour: (delta: [number, number]) => void
  addLaserText: (panelId: string) => void
  updateLaserText: (
    id: string,
    changes: Partial<Omit<LaserTextDefinition, 'id' | 'panelId'>>,
  ) => void
  removeLaserText: (id: string) => void
  dismissMissingFonts: () => void
  addMaterial: (material: Omit<MaterialDefinition, 'id'>) => void
  updateMaterial: (
    id: string,
    changes: Partial<Omit<MaterialDefinition, 'id'>>,
  ) => void
  assignMaterial: (materialId: string) => void
  createFingerJoint: (options: {
    connectionType: 'finger' | 'tab-slot'
    fingerWidth: number
    fit: FitPreset
    clearance: number
    style: FingerStyle
    reliefDiameter: number
  }) => void
  createCrossJoint: (options: {
    ratio: number
    fit: FitPreset
    clearance: number
    firstFromHigh?: boolean
  }) => void
  removeCrossJoint: (jointId: string) => void
  removeFingerJoint: (jointId: string) => void
  removeFingerJointsFromSelection: () => void
  applyBoolean: (operation: BooleanOperation) => void
  swapSelectionOrder: () => void
  updateBoolean: (
    targetId: string,
    modifierId: string,
    operation: BooleanOperation,
  ) => void
  removeBoolean: (targetId: string, modifierId: string) => void
  updateCut: (
    panelId: string,
    cutId: string,
    property: 'center' | 'size',
    axis: 0 | 1 | 2,
    value: number,
  ) => void
  removeCut: (panelId: string, cutId: string) => void
  resizePanel: (
    id: PanelDefinition['id'],
    size: [number, number, number],
  ) => void
  movePanel: (
    id: PanelDefinition['id'],
    position: [number, number, number],
  ) => void
  setPanelPosition: (
    id: PanelDefinition['id'],
    position: [number, number, number],
  ) => void
  setSelectionPosition: (position: [number, number, number]) => void
  rotatePanel: (
    id: PanelDefinition['id'],
    rotation: [number, number, number],
  ) => void
  setSelectionHeight: (height: number) => void
  setTransformMode: (mode: TransformMode) => void
  setTransformConstraint: (constraint: TransformConstraint) => void
  toggleSnap: () => void
  setRotationStep: (degrees: number) => void
  setTranslationStep: (millimeters: number) => void
  setScaleStep: (fraction: number) => void
  toggleTransformGrid: () => void
  setColorMode: (mode: 'material' | 'object') => void
  setSelectionColor: (color?: string) => void
  undo: () => void
  redo: () => void
  beginTransform: () => void
  endTransform: () => void
  setRotationPreview: (
    preview: { panelId: string; rotation: [number, number, number] } | null,
  ) => void
  setJointPreview: (preview: EditorState['jointPreview']) => void
  setWorkspace: (workspace: Workspace) => void
  newProject: (template: 'empty' | 'box') => void
  serializeProject: () => string
  loadProject: (contents: string) => boolean
  serializeGroup: (id: string) => string
  updateExportLayer: (
    id: string,
    changes: Partial<
      Omit<ExportLayerDefinition, 'id' | 'materialId' | 'operation'>
    >,
  ) => void
  moveExportLayer: (id: string, direction: -1 | 1) => void
  reorderExportLayer: (
    id: string,
    targetId: string,
    position?: 'before' | 'after',
  ) => void
  resetExportLayers: () => void
  addLaserCutter: (laser: Omit<LaserCutterDefinition, 'id'>) => void
  updateLaserCutter: (
    id: string,
    changes: Partial<Omit<LaserCutterDefinition, 'id'>>,
  ) => void
  selectLaserCutter: (id: string) => void
  updateLaserPreset: (
    id: string,
    changes: Partial<
      Omit<LaserPreset, 'id' | 'laserId' | 'materialId' | 'operation'>
    >,
  ) => void
  updateStandardCut: (
    laserId: string,
    materialId: string,
    changes: Partial<
      Omit<LaserPreset, 'id' | 'laserId' | 'materialId' | 'operation'>
    >,
  ) => void
  updateCutLayer: (
    laserId: string,
    materialId: string,
    operation: 'cut-inner' | 'cut-outer',
    changes: Partial<
      Omit<LaserPreset, 'id' | 'laserId' | 'materialId' | 'operation'>
    >,
  ) => void
  addProcessingProfile: (
    profile: Omit<ProcessingProfile, 'id' | 'order'>,
  ) => void
  updateProcessingProfile: (
    id: string,
    changes: Partial<Omit<ProcessingProfile, 'id'>>,
  ) => void
  removeProcessingProfile: (id: string) => void
  moveProcessingProfile: (id: string, direction: -1 | 1) => void
  addProcessingAssignment: (panelId: string, profileId: string) => void
  removeProcessingAssignment: (panelId: string, assignmentId: string) => void
  setPanelAutoCut: (panelId: string, enabled: boolean) => void
  updateProcessingRecipe: (
    profileId: string,
    laserId: string,
    materialId: string,
    changes: Partial<
      Omit<ProcessingRecipe, 'id' | 'profileId' | 'laserId' | 'materialId'>
    >,
  ) => void
}

type ProjectState = Pick<
  EditorState,
  | 'box'
  | 'panels'
  | 'materials'
  | 'fingerJoints'
  | 'crossJoints'
  | 'laserTexts'
  | 'selectedPanels'
  | 'workspace'
  | 'transformMode'
  | 'transformConstraint'
  | 'snapEnabled'
  | 'rotationStep'
  | 'translationStep'
  | 'scaleStep'
  | 'transformGridEnabled'
  | 'colorMode'
  | 'exportLayers'
  | 'laserCutters'
  | 'laserPresets'
  | 'processingProfiles'
  | 'processingRecipes'
  | 'activeLaserId'
  | 'groups'
  | 'selectedGroupId'
>

type ProjectDocument = {
  format: 'lasercut-studio'
  version: 1
  savedAt: string
  current: ProjectState
  history: { past: HistorySnapshot[]; future: HistorySnapshot[] }
}

const autosaveKey = 'lasercut-studio.project.v1'
const hasOffCenterImportedSvg = (panels: PanelDefinition[]) =>
  panels.some((panel) => {
    if (panel.shape?.type !== 'free' || panel.shape.sourceType !== 'svg')
      return false
    const points = panel.shape.faces
      .flatMap((face) => [face.outer, ...face.holes])
      .flat()
    if (!points.length) return false
    const centerX =
      (Math.min(...points.map((point) => point[0])) +
        Math.max(...points.map((point) => point[0]))) /
      2
    const centerY =
      (Math.min(...points.map((point) => point[1])) +
        Math.max(...points.map((point) => point[1]))) /
      2
    return Math.abs(centerX) >= 1e-7 || Math.abs(centerY) >= 1e-7
  })
const recenterImportedSvgPanels = (panels: PanelDefinition[]) =>
  panels.map((panel) => {
    if (panel.shape?.type !== 'free' || panel.shape.sourceType !== 'svg')
      return panel
    const points = panel.shape.faces
      .flatMap((face) => [face.outer, ...face.holes])
      .flat()
    if (!points.length) return panel
    const localCenterX =
      (Math.min(...points.map((point) => point[0])) +
        Math.max(...points.map((point) => point[0]))) /
      2
    const localCenterY =
      (Math.min(...points.map((point) => point[1])) +
        Math.max(...points.map((point) => point[1]))) /
      2
    if (Math.abs(localCenterX) < 1e-7 && Math.abs(localCenterY) < 1e-7)
      return panel
    const worldOffset = new Vector3(localCenterX, localCenterY, 0).applyEuler(
      new Euler(...panel.rotation),
    )
    return {
      ...panel,
      position: [
        panel.position[0] + worldOffset.x,
        panel.position[1] + worldOffset.y,
        panel.position[2] + worldOffset.z,
      ] as [number, number, number],
      shape: {
        ...panel.shape,
        faces: panel.shape.faces.map((face) => ({
          ...face,
          outer: face.outer.map(
            ([x, y]) =>
              [x - localCenterX, y - localCenterY] as [number, number],
          ),
          holes: face.holes.map((hole) =>
            hole.map(
              ([x, y]) =>
                [x - localCenterX, y - localCenterY] as [number, number],
            ),
          ),
        })),
      },
    }
  })
const projectStateOf = (state: EditorState): ProjectState => ({
  box: state.box,
  panels: state.panels,
  materials: state.materials,
  fingerJoints: state.fingerJoints,
  crossJoints: state.crossJoints,
  laserTexts: state.laserTexts,
  selectedPanels: state.selectedPanels,
  workspace: state.workspace,
  transformMode: state.transformMode,
  transformConstraint: state.transformConstraint,
  snapEnabled: state.snapEnabled,
  rotationStep: state.rotationStep,
  translationStep: state.translationStep,
  scaleStep: state.scaleStep,
  transformGridEnabled: state.transformGridEnabled,
  colorMode: state.colorMode,
  exportLayers: state.exportLayers,
  laserCutters: state.laserCutters,
  laserPresets: state.laserPresets,
  activeLaserId: state.activeLaserId,
  processingProfiles: state.processingProfiles,
  processingRecipes: state.processingRecipes,
  groups: state.groups,
  selectedGroupId: state.selectedGroupId,
})
const projectDocumentOf = (
  state: EditorState,
  includeHistory = true,
): ProjectDocument => ({
  format: 'lasercut-studio',
  version: 1,
  savedAt: new Date().toISOString(),
  current: projectStateOf(state),
  history: includeHistory
    ? { past: historyPast, future: historyFuture }
    : { past: [], future: [] },
})
const persistCompactAutosave = (state: EditorState) => {
  if (typeof localStorage === 'undefined') return
  const booleanPanelIds = state.panels
    .filter((panel) =>
      panel.booleanModifiers.some((modifier) => modifier.enabled),
    )
    .map((panel) => panel.id)
  pruneBooleanGeometryCache(booleanPanelIds)
  try {
    localStorage.setItem(
      autosaveKey,
      JSON.stringify(projectDocumentOf(state, false)),
    )
  } catch {
    /* Keep the live project usable when storage quota is exhausted. */
  }
}
const parseProject = (contents: string): ProjectDocument | null => {
  try {
    const value = JSON.parse(contents) as Partial<ProjectDocument>
    const current = value.current as Partial<ProjectState> | undefined
    if (
      value.format !== 'lasercut-studio' ||
      value.version !== 1 ||
      !current ||
      !current.box ||
      !Array.isArray(current.panels) ||
      !Array.isArray(current.materials) ||
      !Array.isArray(current.fingerJoints) ||
      !Array.isArray(current.crossJoints) ||
      !Array.isArray(current.selectedPanels) ||
      !value.history ||
      !Array.isArray(value.history.past) ||
      !Array.isArray(value.history.future)
    )
      return null
    if (!Array.isArray(current.exportLayers))
      current.exportLayers = createDefaultExportLayers(current.materials)
    if (!Array.isArray(current.laserCutters))
      current.laserCutters = defaultLaserCutters
    if (!Array.isArray(current.laserPresets))
      current.laserPresets = createDefaultLaserPresets(
        current.laserCutters,
        current.materials,
      )
    if (typeof current.activeLaserId !== 'string')
      current.activeLaserId = current.laserCutters[0]?.id ?? ''
    const rawProfiles = Array.isArray(current.processingProfiles)
      ? (current.processingProfiles as unknown as Array<
          ProcessingProfile & ProcessingRecipe & { referenceDepth?: number }
        >)
      : []
    const legacyProfiles = rawProfiles.filter(
      (profile) =>
        typeof profile.laserId === 'string' &&
        typeof profile.materialId === 'string',
    )
    const profileIdMap = new Map<string, string>()
    if (legacyProfiles.length) {
      const byIntent = new Map<string, ProcessingProfile>()
      for (const legacy of legacyProfiles) {
        const key = `${legacy.name}|${legacy.geometry}|${legacy.referenceDepth ?? ''}`
        const intent = byIntent.get(key) ?? {
          id: legacy.id,
          name: legacy.name,
          geometry: legacy.geometry,
          referenceDepth: legacy.referenceDepth,
          color: legacy.color,
          order: byIntent.size,
        }
        byIntent.set(key, intent)
        profileIdMap.set(legacy.id, intent.id)
      }
      current.processingProfiles = [...byIntent.values()]
      current.processingRecipes = legacyProfiles.map((legacy) => ({
        id: `recipe:${legacy.id}`,
        profileId: profileIdMap.get(legacy.id)!,
        laserId: legacy.laserId,
        materialId: legacy.materialId,
        speed: legacy.speed,
        power: legacy.power,
        passes: legacy.passes,
        airAssist: legacy.airAssist,
        lineInterval: legacy.lineInterval,
        focusOffset: legacy.focusOffset,
        layerColor: legacy.color,
      }))
    } else {
      current.processingProfiles = rawProfiles.length
        ? rawProfiles.map(
            ({ id, name, geometry, referenceDepth, color, order }) => ({
              id,
              name,
              geometry,
              referenceDepth,
              color,
              order,
            }),
          )
        : createDefaultProcessingProfiles()
      if (!Array.isArray(current.processingRecipes))
        current.processingRecipes = createDefaultProcessingRecipes(
          current.processingProfiles,
          current.laserCutters,
          current.materials,
        )
    }
    current.processingRecipes = current.processingRecipes.map((recipe) => ({
      ...recipe,
      layerColor:
        recipe.layerColor ??
        current.processingProfiles?.find(
          (profile) => profile.id === recipe.profileId,
        )?.color ??
        '#d000d0',
    }))
    if (!Array.isArray(current.groups))
      current.groups = [
        {
          id: 'group-1',
          name: 'Baugruppe 01',
          panelIds: current.panels.map((panel) => panel.id),
          visible: true,
        },
      ]
    if (current.colorMode !== 'object') current.colorMode = 'material'
    if (!Array.isArray(current.laserTexts)) current.laserTexts = []
    current.laserTexts = current.laserTexts.map((text, index) => ({
      ...text,
      label: text.label || `Text ${index + 1}`,
    }))
    current.groups = current.groups.map((group) => ({
      ...group,
      name: group.name.replace(/^Projektgruppe\b/, 'Baugruppe'),
      visible: group.visible !== false,
    }))
    current.panels = current.panels.map((panel) => {
      if (Array.isArray(panel.processingAssignments))
        return {
          ...panel,
          visible: panel.visible !== false,
          autoCut: panel.autoCut !== false,
          processingAssignments: panel.processingAssignments.map(
            (assignment) => ({
              ...assignment,
              profileId:
                profileIdMap.get(assignment.profileId) ?? assignment.profileId,
            }),
          ),
        }
      const legacyGeometry =
        panel.shape?.type === 'text' && panel.shape.operation !== 'cut'
          ? panel.shape.operation === 'engrave-fill'
            ? 'fill'
            : 'contour'
          : null
      const migratedProfile = legacyGeometry
        ? current.processingProfiles?.find(
            (profile) => profile.geometry === legacyGeometry,
          )
        : undefined
      return {
        ...panel,
        visible: panel.visible !== false,
        autoCut: legacyGeometry ? false : panel.autoCut !== false,
        processingAssignments: migratedProfile
          ? [
              {
                id: operationId('assignment'),
                profileId: migratedProfile.id,
                geometry: legacyGeometry!,
              },
            ]
          : [],
      }
    })
    // Joint features are derived geometry. Rebuild them from their compact
    // definitions when loading so fixes to finger and relief placement also
    // apply to existing projects instead of preserving obsolete coordinates.
    const migratedSvgPivots = hasOffCenterImportedSvg(current.panels)
    current.panels = recenterImportedSvgPanels(current.panels)
    if (migratedSvgPivots) {
      current.selectedGroupId = null
      current.selectedPanels = current.selectedPanels.slice(0, 1)
    }
    value.history.past = value.history.past.map((snapshot) => ({
      ...snapshot,
      panels: recenterImportedSvgPanels(snapshot.panels),
    }))
    value.history.future = value.history.future.map((snapshot) => ({
      ...snapshot,
      panels: recenterImportedSvgPanels(snapshot.panels),
    }))
    const rebuilt = rebuildConnections(
      current.panels,
      current.fingerJoints,
      current.crossJoints,
    )
    current.panels = rebuilt.panels
    current.fingerJoints = rebuilt.fingerJoints
    current.crossJoints = rebuilt.crossJoints
    if (
      current.selectedGroupId !== null &&
      typeof current.selectedGroupId !== 'string'
    )
      current.selectedGroupId = null
    return value as ProjectDocument
  } catch {
    return null
  }
}
const readAutosave = () => {
  if (typeof localStorage === 'undefined') return null
  const contents = localStorage.getItem(autosaveKey)
  return contents ? parseProject(contents) : null
}

const restoredProject = readAutosave()
const initialProcessingProfiles =
  restoredProject?.current.processingProfiles ??
  createDefaultProcessingProfiles()

export const useEditor = create<EditorState>((set) => ({
  box: restoredProject?.current.box ?? defaultBox,
  panels: restoredProject?.current.panels ?? createBoxPanels(defaultBox),
  materials: restoredProject?.current.materials ?? defaultMaterials,
  fingerJoints: restoredProject?.current.fingerJoints ?? [],
  crossJoints: restoredProject?.current.crossJoints ?? [],
  laserTexts: restoredProject?.current.laserTexts ?? [],
  missingFonts: [],
  exportLayers:
    restoredProject?.current.exportLayers ??
    createDefaultExportLayers(
      restoredProject?.current.materials ?? defaultMaterials,
    ),
  laserCutters: restoredProject?.current.laserCutters ?? defaultLaserCutters,
  laserPresets:
    restoredProject?.current.laserPresets ??
    createDefaultLaserPresets(
      defaultLaserCutters,
      restoredProject?.current.materials ?? defaultMaterials,
    ),
  processingProfiles: initialProcessingProfiles,
  processingRecipes:
    restoredProject?.current.processingRecipes ??
    createDefaultProcessingRecipes(
      initialProcessingProfiles,
      restoredProject?.current.laserCutters ?? defaultLaserCutters,
      restoredProject?.current.materials ?? defaultMaterials,
    ),
  activeLaserId:
    restoredProject?.current.activeLaserId ?? defaultLaserCutters[0].id,
  groups: restoredProject?.current.groups ?? [
    {
      id: 'group-1',
      name: 'Baugruppe 01',
      panelIds: (
        restoredProject?.current.panels ?? createBoxPanels(defaultBox)
      ).map((panel) => panel.id),
      visible: true,
    },
  ],
  selectedGroupId: restoredProject?.current.selectedGroupId ?? null,
  selectedPanels: restoredProject?.current.selectedPanels ?? [],
  selectedTextId: null,
  workspace: restoredProject?.current.workspace ?? 'model',
  transformMode: restoredProject?.current.transformMode ?? 'translate',
  transformConstraint: restoredProject?.current.transformConstraint ?? 'free',
  geometrySelectionMode: 'object',
  contourSelection: null,
  snapEnabled: restoredProject?.current.snapEnabled ?? true,
  rotationStep: restoredProject?.current.rotationStep ?? 15,
  translationStep: restoredProject?.current.translationStep ?? 5,
  scaleStep: restoredProject?.current.scaleStep ?? 0.05,
  transformGridEnabled: restoredProject?.current.transformGridEnabled ?? false,
  colorMode: restoredProject?.current.colorMode ?? 'material',
  operationMessage: restoredProject
    ? 'Lokales Projekt automatisch wiederhergestellt.'
    : null,
  canUndo: Boolean(restoredProject?.history.past.length),
  canRedo: Boolean(restoredProject?.history.future.length),
  rotationPreview: null,
  jointPreview: null,
  setJointPreview: (jointPreview) => set({ jointPreview }),
  setDimension: (key, value) =>
    set((state) => {
      if (key === 'thickness')
        return {
          operationMessage:
            'Die Materialstärke wird ausschließlich über das Material festgelegt.',
        }
      const box = { ...state.box, [key]: value }
      const commonMaterialId =
        state.panels[0]?.materialId &&
        state.panels.every(
          (panel) => panel.materialId === state.panels[0].materialId,
        )
          ? state.panels[0].materialId
          : undefined
      const panels = createBoxPanels(box).map((panel) =>
        commonMaterialId ? { ...panel, materialId: commonMaterialId } : panel,
      )
      return {
        box,
        panels,
        groups: [
          {
            id: state.groups[0]?.id ?? 'group-1',
            name: state.groups[0]?.name ?? 'Baugruppe 01',
            panelIds: panels.map((panel) => panel.id),
            visible: true,
          },
        ],
        fingerJoints: [],
        crossJoints: [],
        laserTexts: [],
        selectedPanels: [],
        selectedGroupId: null,
        selectedTextId: null,
      }
    }),
  selectPanel: (id, additive = false) =>
    set((state) => {
      if (id === null)
        return {
          selectedPanels: [],
          selectedGroupId: null,
          selectedTextId: null,
          contourSelection: null,
        }
      if (!additive)
        return {
          selectedPanels: [id],
          selectedGroupId: null,
          selectedTextId: null,
          contourSelection:
            state.contourSelection?.panelId === id
              ? state.contourSelection
              : null,
        }
      return {
        selectedPanels: state.selectedPanels.includes(id)
          ? state.selectedPanels.filter((selected) => selected !== id)
          : [...state.selectedPanels, id],
        selectedGroupId: null,
      }
    }),
  selectPanels: (ids, additive = false) =>
    set((state) => {
      const valid = ids.filter((id) =>
        state.panels.some((panel) => panel.id === id),
      )
      return {
        selectedPanels: additive
          ? [...new Set([...state.selectedPanels, ...valid])]
          : valid,
        selectedGroupId: null,
        selectedTextId: null,
        contourSelection: null,
      }
    }),
  selectLaserText: (id) =>
    set((state) =>
      id && state.laserTexts.some((text) => text.id === id)
        ? { selectedTextId: id, selectedPanels: [], selectedGroupId: null }
        : { selectedTextId: null },
    ),
  selectGroup: (id) =>
    set((state) => {
      const group = state.groups.find((candidate) => candidate.id === id)
      return group
        ? {
            selectedGroupId: group.id,
            selectedPanels: group.panelIds.filter((panelId) =>
              state.panels.some((panel) => panel.id === panelId),
            ),
            selectedTextId: null,
          }
        : { selectedGroupId: null, selectedPanels: [], selectedTextId: null }
    }),
  togglePanelVisibility: (id) =>
    set((state) => ({
      panels: state.panels.map((panel) =>
        panel.id === id
          ? { ...panel, visible: panel.visible === false }
          : panel,
      ),
      selectedPanels:
        state.panels.find((panel) => panel.id === id)?.visible !== false
          ? state.selectedPanels.filter((panelId) => panelId !== id)
          : state.selectedPanels,
    })),
  toggleGroupVisibility: (id) =>
    set((state) => {
      const group = state.groups.find((candidate) => candidate.id === id)
      if (!group) return state
      const allChildrenVisible = group.panelIds.every(
        (id) =>
          state.panels.find((panel) => panel.id === id)?.visible !== false,
      )
      const showAll = group.visible === false || !allChildrenVisible
      return {
        groups: state.groups.map((candidate) =>
          candidate.id === id ? { ...candidate, visible: showAll } : candidate,
        ),
        panels: showAll
          ? state.panels.map((panel) =>
              group.panelIds.includes(panel.id)
                ? { ...panel, visible: true }
                : panel,
            )
          : state.panels,
        selectedGroupId: showAll
          ? state.selectedGroupId
          : state.selectedGroupId === id
            ? null
            : state.selectedGroupId,
        selectedPanels: showAll
          ? state.selectedPanels
          : state.selectedPanels.filter(
              (panelId) => !group.panelIds.includes(panelId),
            ),
      }
    }),
  createGroup: () =>
    set((state) => {
      const id = operationId('group')
      const group = {
        id,
        name: `Baugruppe ${String(state.groups.length + 1).padStart(2, '0')}`,
        panelIds: [...state.selectedPanels],
        visible: true,
      }
      const selected = new Set(state.selectedPanels)
      return {
        groups: [
          ...state.groups.map((candidate) => ({
            ...candidate,
            panelIds: candidate.panelIds.filter(
              (panelId) => !selected.has(panelId),
            ),
          })),
          group,
        ],
        selectedGroupId: id,
        operationMessage: `${group.name} angelegt.`,
      }
    }),
  duplicateGroup: (id) =>
    set((state) => {
      const source = state.groups.find((group) => group.id === id)
      if (!source) return state
      const panelMap = new Map(
        source.panelIds.map((panelId) => [panelId, operationId('panel')]),
      )
      const jointIds = new Map<string, string>()
      const sourceJointIds = new Set([
        ...state.fingerJoints
          .filter(
            (joint) =>
              panelMap.has(joint.firstPanelId) &&
              panelMap.has(joint.secondPanelId),
          )
          .map((joint) => joint.id),
        ...state.crossJoints
          .filter(
            (joint) =>
              panelMap.has(joint.firstPanelId) &&
              panelMap.has(joint.secondPanelId),
          )
          .map((joint) => joint.id),
      ])
      sourceJointIds.forEach((jointId) =>
        jointIds.set(jointId, operationId('joint')),
      )
      const copies = state.panels
        .filter((panel) => panelMap.has(panel.id))
        .map((panel) => ({
          ...panel,
          id: panelMap.get(panel.id)!,
          label: `${panel.label} Kopie`,
          position: [
            panel.position[0] + 20,
            panel.position[1],
            panel.position[2] + 20,
          ] as [number, number, number],
          cuts: panel.cuts
            .filter((cut) => !cut.jointId || sourceJointIds.has(cut.jointId))
            .map((cut) => ({
              ...cut,
              id: operationId('cut'),
              jointId: cut.jointId ? jointIds.get(cut.jointId) : undefined,
            })),
          jointFeatures: panel.jointFeatures
            .filter((feature) => sourceJointIds.has(feature.jointId))
            .map((feature) => ({
              ...feature,
              id: operationId('feature'),
              jointId: jointIds.get(feature.jointId)!,
            })),
          booleanModifiers: panel.booleanModifiers
            .filter((modifier) => panelMap.has(modifier.toolId))
            .map((modifier) => ({
              ...modifier,
              id: operationId('boolean'),
              toolId: panelMap.get(modifier.toolId)!,
            })),
          visible: true,
        }))
      const fingerJoints = state.fingerJoints
        .filter((joint) => jointIds.has(joint.id))
        .map((joint) => ({
          ...joint,
          id: jointIds.get(joint.id)!,
          firstPanelId: panelMap.get(joint.firstPanelId)!,
          secondPanelId: panelMap.get(joint.secondPanelId)!,
        }))
      const crossJoints = state.crossJoints
        .filter((joint) => jointIds.has(joint.id))
        .map((joint) => ({
          ...joint,
          id: jointIds.get(joint.id)!,
          firstPanelId: panelMap.get(joint.firstPanelId)!,
          secondPanelId: panelMap.get(joint.secondPanelId)!,
        }))
      const group = {
        id: operationId('group'),
        name: `${source.name} Kopie`,
        panelIds: copies.map((panel) => panel.id),
        visible: true,
        displayColor: source.displayColor,
      }
      return {
        panels: [...state.panels, ...copies],
        groups: [...state.groups, group],
        fingerJoints: [...state.fingerJoints, ...fingerJoints],
        crossJoints: [...state.crossJoints, ...crossJoints],
        selectedGroupId: group.id,
        selectedPanels: group.panelIds,
        operationMessage: `${group.name} angelegt und um 20 mm versetzt.`,
      }
    }),
  deleteGroup: (id) =>
    set((state) => {
      const group = state.groups.find((candidate) => candidate.id === id)
      if (!group) return state
      const removed = new Set(group.panelIds)
      const remainingFinger = state.fingerJoints.filter(
        (joint) =>
          !removed.has(joint.firstPanelId) && !removed.has(joint.secondPanelId),
      )
      const remainingCross = state.crossJoints.filter(
        (joint) =>
          !removed.has(joint.firstPanelId) && !removed.has(joint.secondPanelId),
      )
      const validJointIds = new Set(
        [...remainingFinger, ...remainingCross].map((joint) => joint.id),
      )
      return {
        panels: state.panels
          .filter((panel) => !removed.has(panel.id))
          .map((panel) => ({
            ...panel,
            booleanModifiers: panel.booleanModifiers.filter(
              (modifier) => !removed.has(modifier.toolId),
            ),
            jointFeatures: panel.jointFeatures.filter((feature) =>
              validJointIds.has(feature.jointId),
            ),
            cuts: panel.cuts.filter(
              (cut) => !cut.jointId || validJointIds.has(cut.jointId),
            ),
          })),
        groups: state.groups.filter((candidate) => candidate.id !== id),
        fingerJoints: remainingFinger,
        crossJoints: remainingCross,
        laserTexts: state.laserTexts.filter(
          (text) => !removed.has(text.panelId),
        ),
        selectedGroupId:
          state.selectedGroupId === id ? null : state.selectedGroupId,
        selectedPanels: state.selectedPanels.filter(
          (panelId) => !removed.has(panelId),
        ),
        operationMessage: `${group.name} und ${removed.size} enthaltene Teile gelöscht.`,
      }
    }),
  renameGroup: (id, name) =>
    set((state) => ({
      groups: state.groups.map((group) =>
        group.id === id ? { ...group, name: name.trim() || group.name } : group,
      ),
    })),
  renamePanel: (id, name) =>
    set((state) => {
      const panel = state.panels.find((candidate) => candidate.id === id)
      const label = name.trim()
      if (!panel || !label || label === panel.label) return state
      return {
        panels: state.panels.map((candidate) =>
          candidate.id === id ? { ...candidate, label } : candidate,
        ),
        operationMessage: `Objekt in „${label}“ umbenannt.`,
      }
    }),
  assignSelectionToGroup: (id) =>
    set((state) => {
      const selected = new Set(state.selectedPanels)
      return {
        groups: state.groups.map((group) => ({
          ...group,
          panelIds:
            group.id === id
              ? [...new Set([...group.panelIds, ...state.selectedPanels])]
              : group.panelIds.filter((panelId) => !selected.has(panelId)),
        })),
        selectedGroupId: id,
      }
    }),
  moveSelectedBy: (delta) =>
    set((state) => {
      const moved = state.panels.map((panel) =>
        state.selectedPanels.includes(panel.id)
          ? {
              ...panel,
              position: panel.position.map(
                (value, axis) => value + delta[axis],
              ) as [number, number, number],
            }
          : panel,
      )
      const rebuilt = rebuildConnections(
        moved,
        state.fingerJoints,
        state.crossJoints,
        new Set(state.selectedPanels),
      )
      return {
        panels: rebuilt.panels,
        fingerJoints: rebuilt.fingerJoints,
        crossJoints: rebuilt.crossJoints,
      }
    }),
  transformSelectedGroup: (center, position, rotation, scale) =>
    set((state) => {
      const selected = new Set(state.selectedPanels)
      const groupRotation = new Quaternion().setFromEuler(
        new Euler(...rotation),
      )
      const transformed = state.panels.map((panel) => {
        if (!selected.has(panel.id)) return panel
        const relative = new Vector3(...panel.position)
          .sub(new Vector3(...center))
          .multiplyScalar(scale)
          .applyQuaternion(groupRotation)
        const panelRotation = new Quaternion()
          .setFromEuler(new Euler(...panel.rotation))
          .premultiply(groupRotation)
        const nextRotation = new Euler().setFromQuaternion(panelRotation, 'XYZ')
        return {
          ...panel,
          position: relative.add(new Vector3(...position)).toArray() as [
            number,
            number,
            number,
          ],
          rotation: [nextRotation.x, nextRotation.y, nextRotation.z] as [
            number,
            number,
            number,
          ],
          size: panel.size.map((value, axis) =>
            axis === thinAxis(panel) ? value : Math.max(0.1, value * scale),
          ) as [number, number, number],
        }
      })
      const rebuilt = rebuildConnections(
        transformed,
        state.fingerJoints,
        state.crossJoints,
        selected,
      )
      return {
        panels: rebuilt.panels,
        fingerJoints: rebuilt.fingerJoints,
        crossJoints: rebuilt.crossJoints,
        operationMessage: `${state.selectedGroupId ? 'Baugruppe' : 'Mehrfachauswahl'} ${Math.abs(scale - 1) > 1e-7 ? 'skaliert' : rotation.some((value) => Math.abs(value) > 1e-7) ? 'gedreht' : 'verschoben'}.${rebuilt.failed.length ? ` ${rebuilt.failed.length} nicht mehr mögliche Verbindung(en) entfernt.` : ''}`,
      }
    }),
  removeSelected: () =>
    set((state) => ({
      panels: state.panels.filter(
        (panel) => !state.selectedPanels.includes(panel.id),
      ),
      laserTexts: state.laserTexts.filter(
        (text) =>
          text.id !== state.selectedTextId &&
          !state.selectedPanels.includes(text.panelId),
      ),
      groups: state.groups.map((group) => ({
        ...group,
        panelIds: group.panelIds.filter(
          (id) => !state.selectedPanels.includes(id),
        ),
      })),
      selectedPanels: [],
      selectedGroupId: null,
      selectedTextId: null,
    })),
  duplicateSelected: () =>
    set((state) => {
      const selected = new Set(state.selectedPanels)
      if (!selected.size)
        return { operationMessage: 'Keine Objekte zum Duplizieren ausgewählt.' }
      const panelIds = new Map(
        state.panels
          .filter((panel) => selected.has(panel.id))
          .map((panel) => [panel.id, operationId('panel')]),
      )
      const sourceFinger = state.fingerJoints.filter(
        (joint) =>
          selected.has(joint.firstPanelId) || selected.has(joint.secondPanelId),
      )
      const sourceCross = state.crossJoints.filter(
        (joint) =>
          selected.has(joint.firstPanelId) || selected.has(joint.secondPanelId),
      )
      const jointIds = new Map(
        [...sourceFinger, ...sourceCross].map((joint) => [
          joint.id,
          operationId('joint'),
        ]),
      )
      const copies = state.panels
        .filter((panel) => selected.has(panel.id))
        .map((panel) => ({
          ...panel,
          id: panelIds.get(panel.id)!,
          label: `${panel.label} Kopie`,
          position: [...panel.position] as [number, number, number],
          cuts: panel.cuts
            .filter((cut) => !cut.jointId)
            .map((cut) => ({ ...cut, id: operationId('cut') })),
          jointFeatures: [],
          booleanModifiers: panel.booleanModifiers
            .filter((modifier) => panelIds.has(modifier.toolId))
            .map((modifier) => ({
              ...modifier,
              id: operationId('boolean'),
              toolId: panelIds.get(modifier.toolId)!,
            })),
          visible: true,
        }))
      const fingerJoints = sourceFinger.map((joint) => ({
        ...joint,
        id: jointIds.get(joint.id)!,
        firstPanelId: panelIds.get(joint.firstPanelId) ?? joint.firstPanelId,
        secondPanelId: panelIds.get(joint.secondPanelId) ?? joint.secondPanelId,
      }))
      const crossJoints = sourceCross.map((joint) => ({
        ...joint,
        id: jointIds.get(joint.id)!,
        firstPanelId: panelIds.get(joint.firstPanelId) ?? joint.firstPanelId,
        secondPanelId: panelIds.get(joint.secondPanelId) ?? joint.secondPanelId,
      }))
      const laserTexts = state.laserTexts
        .filter((text) => panelIds.has(text.panelId))
        .map((text) => ({
          ...text,
          id: operationId('text'),
          label: `${text.label} Kopie`,
          panelId: panelIds.get(text.panelId)!,
        }))
      const groups = state.groups.map((group) => ({
        ...group,
        panelIds: [
          ...group.panelIds,
          ...group.panelIds
            .filter((id) => panelIds.has(id))
            .map((id) => panelIds.get(id)!),
        ],
      }))
      const rebuilt = rebuildConnections(
        [...state.panels, ...copies],
        [...state.fingerJoints, ...fingerJoints],
        [...state.crossJoints, ...crossJoints],
        new Set(copies.map((panel) => panel.id)),
      )
      return {
        panels: rebuilt.panels,
        groups,
        fingerJoints: rebuilt.fingerJoints,
        crossJoints: rebuilt.crossJoints,
        laserTexts: [...state.laserTexts, ...laserTexts],
        selectedPanels: copies.map((panel) => panel.id),
        selectedGroupId: null,
        selectedTextId: null,
        operationMessage: `${copies.length} Objekt${copies.length === 1 ? '' : 'e'} mit ${fingerJoints.length + crossJoints.length} Verbindung${fingerJoints.length + crossJoints.length === 1 ? '' : 'en'} dupliziert.`,
      }
    }),
  addPanel: () =>
    set((state) => {
      const commonMaterialId =
        state.panels[0]?.materialId &&
        state.panels.every(
          (panel) => panel.materialId === state.panels[0].materialId,
        )
          ? state.panels[0].materialId
          : undefined
      const material =
        state.materials.find(
          (candidate) => candidate.id === commonMaterialId,
        ) ?? state.materials[0]
      const t = material?.thickness ?? state.box.thickness
      const panel: PanelDefinition = {
        id: operationId('panel'),
        label: `Platte ${String(nextPanelNumber++).padStart(2, '0')}`,
        size: [80, 100, t],
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        cuts: [],
        booleanModifiers: [],
        jointFeatures: [],
        hidden: false,
        visible: true,
        autoCut: true,
        processingAssignments: [],
        materialId: material?.id,
      }
      const targetGroupId = state.selectedGroupId ?? state.groups[0]?.id
      return {
        panels: [...state.panels, panel],
        groups: state.groups.map((group) =>
          group.id === targetGroupId
            ? { ...group, panelIds: [...group.panelIds, panel.id] }
            : group,
        ),
        selectedPanels: [panel.id],
        selectedGroupId: null,
        selectedTextId: null,
        operationMessage: `${panel.label} angelegt`,
      }
    }),
  addShape: (shapeType) =>
    set((state) => {
      const commonMaterialId =
        state.panels[0]?.materialId &&
        state.panels.every(
          (panel) => panel.materialId === state.panels[0].materialId,
        )
          ? state.panels[0].materialId
          : undefined
      const material =
        state.materials.find(
          (candidate) => candidate.id === commonMaterialId,
        ) ?? state.materials[0]
      const t = material?.thickness ?? state.box.thickness
      const shape: PanelShape =
        shapeType === 'circle'
          ? { type: 'circle', segments: 64 }
          : shapeType === 'star'
            ? { type: 'star', points: 5, innerRatio: 0.45 }
            : shapeType === 'polygon'
              ? { type: 'polygon', sides: 6 }
              : shapeType === 'text'
                ? {
                    type: 'text',
                    text: 'Text',
                    fontFamily: bundledFontFamily,
                    fontSize: 20,
                    display: 'filled',
                    operation: 'cut',
                    outline: null,
                  }
                : shapeType === 'triangle'
                  ? { type: 'triangle' }
                  : { type: 'rectangle' }
      const labels = {
        rectangle: 'Rechteckplatte',
        triangle: 'Dreieckplatte',
        circle: 'Kreisplatte',
        star: 'Sternplatte',
        polygon: 'Vieleckplatte',
        text: 'Text',
        free: 'Freie Kontur',
      }
      const defaultTextProfile =
        shapeType === 'text'
          ? state.processingProfiles.find(
              (profile) => profile.geometry === 'fill',
            )
          : undefined
      const panel: PanelDefinition = {
        id: operationId('shape'),
        label: `${labels[shapeType]} ${String(nextPanelNumber++).padStart(2, '0')}`,
        size: shapeType === 'text' ? [0.1, 0.1, t] : [80, 80, t],
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        cuts: [],
        booleanModifiers: [],
        jointFeatures: [],
        hidden: false,
        visible: true,
        autoCut: shapeType !== 'text',
        processingAssignments: defaultTextProfile
          ? [
              {
                id: operationId('assignment'),
                profileId: defaultTextProfile.id,
                geometry: 'fill',
              },
            ]
          : [],
        materialId: material?.id,
        shape,
      }
      const targetGroupId = state.selectedGroupId ?? state.groups[0]?.id
      return {
        panels: [...state.panels, panel],
        groups: state.groups.map((group) =>
          group.id === targetGroupId
            ? { ...group, panelIds: [...group.panelIds, panel.id] }
            : group,
        ),
        selectedPanels: [panel.id],
        selectedGroupId: null,
        selectedTextId: null,
        operationMessage: `${panel.label} angelegt.`,
      }
    }),
  importSvgObjects: (name, objects) =>
    set((state) => {
      if (!objects.length)
        return {
          operationMessage: 'Die SVG enthält keine importierbaren Formen.',
        }
      const allPoints = objects.flatMap((object) =>
        object.faces.flatMap((face) => [face.outer, ...face.holes]).flat(),
      )
      const centerX =
        (Math.min(...allPoints.map((point) => point[0])) +
          Math.max(...allPoints.map((point) => point[0]))) /
        2
      const centerY =
        (Math.min(...allPoints.map((point) => point[1])) +
          Math.max(...allPoints.map((point) => point[1]))) /
        2
      const panels = objects.map((object, index): PanelDefinition => {
        const material =
          state.materials.find(
            (candidate) => candidate.id === object.materialId,
          ) ?? state.materials[0]
        const objectPoints = object.faces
          .flatMap((face) => [face.outer, ...face.holes])
          .flat()
        const objectCenterX =
          (Math.min(...objectPoints.map((point) => point[0])) +
            Math.max(...objectPoints.map((point) => point[0]))) /
          2
        const objectCenterY =
          (Math.min(...objectPoints.map((point) => point[1])) +
            Math.max(...objectPoints.map((point) => point[1]))) /
          2
        const faces = object.faces.map((face) => ({
          ...face,
          id: operationId('face'),
          outer: face.outer.map(
            ([x, y]) =>
              [x - objectCenterX, y - objectCenterY] as [number, number],
          ),
          holes: face.holes.map((hole) =>
            hole.map(
              ([x, y]) =>
                [x - objectCenterX, y - objectCenterY] as [number, number],
            ),
          ),
        }))
        const points = faces
          .flatMap((face) => [face.outer, ...face.holes])
          .flat()
        return {
          id: operationId('svg'),
          label: object.name.trim() || `SVG-Form ${index + 1}`,
          size: [
            Math.max(
              0.1,
              Math.max(...points.map((point) => point[0])) -
                Math.min(...points.map((point) => point[0])),
            ),
            Math.max(
              0.1,
              Math.max(...points.map((point) => point[1])) -
                Math.min(...points.map((point) => point[1])),
            ),
            material?.thickness ?? 3,
          ],
          position: [objectCenterX - centerX, objectCenterY - centerY, 0],
          rotation: [0, 0, 0],
          cuts: [],
          booleanModifiers: [],
          jointFeatures: [],
          hidden: false,
          visible: true,
          materialId: material?.id,
          autoCut: true,
          processingAssignments: [],
          shape: { type: 'free', sourceType: 'svg', faces },
        }
      })
      const grouped = new Map<string, string[]>()
      panels.forEach((panel, index) => {
        const groupName = objects[index].groupName.trim() || name
        grouped.set(groupName, [...(grouped.get(groupName) ?? []), panel.id])
      })
      const groups = [...grouped].map(([groupName, panelIds]) => ({
        id: operationId('group'),
        name: groupName,
        panelIds,
        visible: true,
      }))
      return {
        panels: [...state.panels, ...panels],
        groups: [...state.groups, ...groups],
        selectedPanels: [panels[0].id],
        selectedGroupId: null,
        selectedTextId: null,
        workspace: 'model',
        operationMessage: `${panels.length} SVG-Form${panels.length === 1 ? '' : 'en'} als ${groups.length} Baugruppe${groups.length === 1 ? '' : 'n'} importiert. Das erste Teil ist einzeln ausgewählt.`,
      }
    }),
  updatePanelShape: (id, shape) =>
    set((state) => ({
      panels: state.panels.map((panel) =>
        panel.id === id ? { ...panel, shape } : panel,
      ),
    })),
  setGeometrySelectionMode: (geometrySelectionMode) =>
    set({ geometrySelectionMode, contourSelection: null }),
  convertPanelToFreeContour: (id, keepCopy = false) =>
    set((state) => {
      const source = state.panels.find((panel) => panel.id === id)
      if (!source) return state
      const converted = { ...source, shape: shapeToFreeContour(source) }
      if (!keepCopy)
        return {
          panels: state.panels.map((panel) =>
            panel.id === id ? converted : panel,
          ),
          contourSelection: null,
          operationMessage:
            'Objekt in eine frei bearbeitbare Laserkontur umgewandelt.',
        }
      const copy = {
        ...converted,
        id: operationId('contour'),
        label: `${source.label} · Kontur`,
        position: [
          source.position[0] + 10,
          source.position[1] + 10,
          source.position[2],
        ] as [number, number, number],
      }
      return {
        panels: [...state.panels, copy],
        groups: state.groups.map((group) =>
          group.panelIds.includes(id)
            ? { ...group, panelIds: [...group.panelIds, copy.id] }
            : group,
        ),
        selectedPanels: [copy.id],
        selectedGroupId: null,
        contourSelection: null,
        operationMessage:
          'Parametrisches Original behalten und bearbeitbare Kontur als Kopie angelegt.',
      }
    }),
  selectContourFace: (panelId, faceIndex, ringIndex, edgeIndex) =>
    set((state) => ({
      panels: state.panels.map((panel) =>
        panel.id === panelId && panel.shape?.type !== 'free'
          ? { ...panel, shape: shapeToFreeContour(panel) }
          : panel,
      ),
      contourSelection: {
        panelId,
        faceIndex,
        ringIndex,
        edgeIndex,
        kind: 'face',
      },
    })),
  selectContourEdge: (panelId, faceIndex, ringIndex, edgeIndex) =>
    set((state) => ({
      panels: state.panels.map((panel) =>
        panel.id === panelId && panel.shape?.type !== 'free'
          ? { ...panel, shape: shapeToFreeContour(panel) }
          : panel,
      ),
      contourSelection: {
        panelId,
        faceIndex,
        ringIndex,
        edgeIndex,
        kind: 'edge',
      },
    })),
  moveSelectedContour: (delta) =>
    set((state) => {
      const selection = state.contourSelection
      if (!selection) return state
      return {
        panels: state.panels.map((panel) => {
          if (panel.id !== selection.panelId || panel.shape?.type !== 'free')
            return panel
          const faces = panel.shape.faces.map((face, faceIndex) => {
            if (faceIndex !== selection.faceIndex) return face
            const moved = (point: [number, number]): [number, number] => [
              point[0] + delta[0],
              point[1] + delta[1],
            ]
            const rings = [face.outer, ...face.holes].map((ring) =>
              ring.map((point) => [...point] as [number, number]),
            )
            const ringIndex = selection.ringIndex + 1
            const ring = rings[ringIndex]
            if (!ring?.length) return face
            ring[selection.edgeIndex] = moved(ring[selection.edgeIndex])
            if (selection.kind === 'face') {
              const next = (selection.edgeIndex + 1) % ring.length
              ring[next] = moved(ring[next])
            }
            return { ...face, outer: rings[0], holes: rings.slice(1) }
          })
          return { ...panel, shape: { ...panel.shape, faces } }
        }),
        operationMessage:
          'Kontur geändert; Ober- und Unterkante bleiben parallel.',
      }
    }),
  addLaserText: (panelId) =>
    set((state) => {
      if (!state.panels.some((panel) => panel.id === panelId)) return state
      const text: LaserTextDefinition = {
        id: operationId('text'),
        label: `Text ${state.laserTexts.length + 1}`,
        panelId,
        text: 'Text',
        fontFamily: 'Arial',
        fontSize: 12,
        position: [0, 0],
        rotation: 0,
        operation: 'engrave-fill',
      }
      return {
        laserTexts: [...state.laserTexts, text],
        selectedTextId: text.id,
        selectedPanels: [],
        selectedGroupId: null,
        operationMessage: 'Textobjekt angelegt.',
      }
    }),
  updateLaserText: (id, changes) =>
    set((state) => ({
      laserTexts: state.laserTexts.map((text) =>
        text.id === id
          ? {
              ...text,
              ...changes,
              fontSize:
                changes.fontSize === undefined
                  ? text.fontSize
                  : Math.max(1, changes.fontSize),
            }
          : text,
      ),
    })),
  removeLaserText: (id) =>
    set((state) => ({
      laserTexts: state.laserTexts.filter((text) => text.id !== id),
    })),
  dismissMissingFonts: () => set({ missingFonts: [] }),
  addMaterial: (material) =>
    set((state) => {
      const created = {
        ...material,
        id: operationId('material'),
        thickness: Math.max(0.1, material.thickness),
        kerf: Math.max(0, material.kerf),
      }
      const combinedLayers = [
        ...state.exportLayers,
        ...createDefaultExportLayers([created]).map((layer, index) => ({
          ...layer,
          order: state.exportLayers.length + index,
        })),
      ]
      const newPresets = createDefaultLaserPresets(state.laserCutters, [
        created,
      ])
      return {
        materials: [...state.materials, created],
        exportLayers: combinedLayers,
        laserPresets: [...state.laserPresets, ...newPresets],
        operationMessage: `${created.name} · ${created.thickness} mm angelegt. Bearbeitungsrezepte für dieses Material können beim Laser nachgepflegt werden.`,
      }
    }),
  updateMaterial: (id, changes) =>
    set((state) => {
      const previous = state.materials.find((material) => material.id === id)
      if (!previous) return state
      const updated = {
        ...previous,
        ...changes,
        thickness:
          changes.thickness === undefined
            ? previous.thickness
            : Math.max(0.1, changes.thickness),
        kerf:
          changes.kerf === undefined
            ? previous.kerf
            : Math.max(0, changes.kerf),
      }
      if (updated.thickness === previous.thickness)
        return {
          materials: state.materials.map((material) =>
            material.id === id ? updated : material,
          ),
        }
      const affected = new Set(
        state.panels
          .filter((panel) => panel.materialId === id)
          .map((panel) => panel.id),
      )
      const resizedPanels = applyMaterialThickness(
        state.panels,
        affected,
        updated.thickness,
      )
      const rebuilt = rebuildConnections(
        resizedPanels,
        state.fingerJoints,
        state.crossJoints,
      )
      return {
        materials: state.materials.map((material) =>
          material.id === id ? updated : material,
        ),
        panels: rebuilt.panels,
        fingerJoints: rebuilt.fingerJoints,
        crossJoints: rebuilt.crossJoints,
        operationMessage: `${updated.name} aktualisiert. Verbindungen wurden mit der neuen Stärke neu berechnet.${rebuilt.failed.length ? ` ${rebuilt.failed.length} geometrisch nicht mehr mögliche Verbindung(en) entfernt.` : ''}`,
      }
    }),
  assignMaterial: (materialId) =>
    set((state) => {
      const material = state.materials.find(
        (candidate) => candidate.id === materialId,
      )
      if (!material) return { operationMessage: 'Material fehlt.' }
      const selected = new Set(
        state.selectedPanels.length
          ? state.selectedPanels
          : state.panels.map((panel) => panel.id),
      )
      const affectsCompleteBox =
        selected.size === state.panels.length &&
        state.panels.every((panel) => selected.has(panel.id))
      const assignedPanels = applyMaterialThickness(
        state.panels,
        selected,
        material.thickness,
      ).map((panel) =>
        selected.has(panel.id) && panel.materialId !== materialId
          ? { ...panel, materialId }
          : panel,
      )
      const rebuilt = rebuildConnections(
        assignedPanels,
        state.fingerJoints,
        state.crossJoints,
      )
      return {
        panels: rebuilt.panels,
        fingerJoints: rebuilt.fingerJoints,
        crossJoints: rebuilt.crossJoints,
        box: affectsCompleteBox
          ? { ...state.box, thickness: material.thickness }
          : state.box,
        operationMessage: `${material.name} · ${material.thickness} mm zugewiesen. Außenflächen bleiben fix; die Stärke wächst nach innen. Verbindungen wurden neu berechnet.${rebuilt.failed.length ? ` ${rebuilt.failed.length} geometrisch nicht mehr mögliche Verbindung(en) entfernt.` : ''}`,
      }
    }),
  createFingerJoint: (options) =>
    set((state) => {
      if (state.selectedPanels.length !== 2)
        return {
          operationMessage:
            'Für eine Fingerverbindung genau zwei Platten auswählen.',
        }
      const first = state.panels.find(
        (panel) => panel.id === state.selectedPanels[0],
      )
      const second = state.panels.find(
        (panel) => panel.id === state.selectedPanels[1],
      )
      if (!first || !second)
        return {
          operationMessage: 'Ausgewählte Platten wurden nicht gefunden.',
        }
      const { connectionType, ...geometryOptions } = options
      const built = buildFingerJoint(
        first,
        second,
        geometryOptions,
        operationId('finger-joint'),
      )
      if ('error' in built) return { operationMessage: built.error }
      const expectedType = connectionType === 'finger' ? 'corner' : 't-joint'
      if (built.definition.connectionType !== expectedType) {
        return {
          operationMessage:
            connectionType === 'finger'
              ? 'Fingerzinken sind hier nicht möglich. Die Platten müssen sich an ihren Kanten treffen.'
              : 'Zapfen & Schlitz benötigen eine anstoßende und eine durchlaufende Platte. Gegebenenfalls Reihenfolge tauschen.',
        }
      }
      return {
        panels: state.panels.map((panel) =>
          panel.id === first.id
            ? {
                ...panel,
                jointFeatures: [...panel.jointFeatures, ...built.firstFeatures],
              }
            : panel.id === second.id
              ? {
                  ...panel,
                  jointFeatures: [
                    ...panel.jointFeatures,
                    ...built.secondFeatures,
                  ],
                }
              : panel,
        ),
        fingerJoints: [...state.fingerJoints, built.definition],
        operationMessage: `${built.definition.connectionType === 'corner' ? 'Eck' : 'T'}-Fingerverbindung erzeugt.`,
      }
    }),
  createCrossJoint: (options) =>
    set((state) => {
      if (state.selectedPanels.length !== 2)
        return {
          operationMessage: 'Für ein Steckkreuz genau zwei Platten auswählen.',
        }
      const first = state.panels.find(
        (panel) => panel.id === state.selectedPanels[0],
      )
      const second = state.panels.find(
        (panel) => panel.id === state.selectedPanels[1],
      )
      if (!first || !second)
        return {
          operationMessage: 'Ausgewählte Platten wurden nicht gefunden.',
        }
      const built = buildCrossJoint(
        first,
        second,
        options,
        operationId('cross-joint'),
      )
      if ('error' in built) return { operationMessage: built.error }
      return {
        panels: state.panels.map((panel) =>
          panel.id === first.id
            ? {
                ...panel,
                cuts: [...panel.cuts, built.firstCut],
                jointFeatures: [...panel.jointFeatures, ...built.firstFeatures],
              }
            : panel.id === second.id
              ? {
                  ...panel,
                  cuts: [...panel.cuts, built.secondCut],
                  jointFeatures: [
                    ...panel.jointFeatures,
                    ...built.secondFeatures,
                  ],
                }
              : panel,
        ),
        crossJoints: [...state.crossJoints, built.definition],
        operationMessage: `Steckkreuz ${Math.round(built.definition.ratio * 100)}/${Math.round((1 - built.definition.ratio) * 100)} erzeugt.`,
      }
    }),
  removeCrossJoint: (jointId) =>
    set((state) => ({
      panels: state.panels.map((panel) => ({
        ...panel,
        cuts: panel.cuts.filter((cut) => cut.jointId !== jointId),
        jointFeatures: panel.jointFeatures.filter(
          (feature) => feature.jointId !== jointId,
        ),
      })),
      crossJoints: state.crossJoints.filter((joint) => joint.id !== jointId),
      operationMessage: 'Steckkreuz entfernt.',
    })),
  removeFingerJoint: (jointId) =>
    set((state) => ({
      panels: state.panels.map((panel) => ({
        ...panel,
        jointFeatures: panel.jointFeatures.filter(
          (feature) => feature.jointId !== jointId,
        ),
      })),
      fingerJoints: state.fingerJoints.filter((joint) => joint.id !== jointId),
      operationMessage: 'Fingerverbindung entfernt.',
    })),
  removeFingerJointsFromSelection: () =>
    set((state) => {
      if (!state.selectedPanels.length)
        return { operationMessage: 'Zuerst mindestens ein Teil auswählen.' }
      const selected = new Set(state.selectedPanels)
      const matching = state.fingerJoints.filter((joint) =>
        state.selectedPanels.length === 1
          ? selected.has(joint.firstPanelId) ||
            selected.has(joint.secondPanelId)
          : selected.has(joint.firstPanelId) &&
            selected.has(joint.secondPanelId),
      )
      if (!matching.length)
        return {
          operationMessage:
            'Zwischen den ausgewählten Teilen gibt es keine Fingerverbindung.',
        }
      const jointIds = new Set(matching.map((joint) => joint.id))
      return {
        panels: state.panels.map((panel) => ({
          ...panel,
          jointFeatures: panel.jointFeatures.filter(
            (feature) => !jointIds.has(feature.jointId),
          ),
        })),
        fingerJoints: state.fingerJoints.filter(
          (joint) => !jointIds.has(joint.id),
        ),
        operationMessage: `${matching.length} Fingerverbindung${matching.length === 1 ? '' : 'en'} entfernt.`,
      }
    }),
  applyBoolean: (operation) =>
    set((state) => {
      if (state.selectedPanels.length !== 2)
        return {
          operationMessage:
            'Für eine boolesche Operation genau Ziel und Werkzeug auswählen.',
        }
      const [targetId, toolId] = state.selectedPanels
      const target = state.panels.find((panel) => panel.id === targetId)
      const tool = state.panels.find((panel) => panel.id === toolId)
      if (!target || !tool)
        return { operationMessage: 'Ziel oder Werkzeug wurde nicht gefunden.' }
      if (
        tool.booleanModifiers.some((modifier) => modifier.toolId === targetId)
      )
        return {
          operationMessage:
            'Diese Operation würde eine zyklische Abhängigkeit erzeugen.',
        }
      const modifier = {
        id: operationId('boolean'),
        operation,
        toolId,
        enabled: true,
      }
      return {
        panels: state.panels.map((panel) =>
          panel.id === targetId
            ? {
                ...panel,
                booleanModifiers: [...panel.booleanModifiers, modifier],
              }
            : panel.id === toolId
              ? { ...panel, hidden: true }
              : panel,
        ),
        selectedPanels: [targetId],
        operationMessage: `${target.label}: Boolean ${operation} mit ${tool.label} angelegt.`,
      }
    }),
  swapSelectionOrder: () =>
    set((state) =>
      state.selectedPanels.length === 2
        ? { selectedPanels: [state.selectedPanels[1], state.selectedPanels[0]] }
        : state,
    ),
  updateBoolean: (targetId, modifierId, operation) =>
    set((state) => ({
      panels: state.panels.map((panel) =>
        panel.id !== targetId
          ? panel
          : {
              ...panel,
              booleanModifiers: panel.booleanModifiers.map((modifier) =>
                modifier.id === modifierId
                  ? { ...modifier, operation }
                  : modifier,
              ),
            },
      ),
    })),
  removeBoolean: (targetId, modifierId) =>
    set((state) => {
      const target = state.panels.find((panel) => panel.id === targetId)
      const removed = target?.booleanModifiers.find(
        (modifier) => modifier.id === modifierId,
      )
      const toolStillUsed =
        state.panels.some(
          (panel) =>
            panel.id !== targetId &&
            panel.booleanModifiers.some(
              (modifier) =>
                modifier.toolId === removed?.toolId &&
                modifier.id !== modifierId,
            ),
        ) ||
        target?.booleanModifiers.some(
          (modifier) =>
            modifier.toolId === removed?.toolId && modifier.id !== modifierId,
        )
      return {
        panels: state.panels.map((panel) =>
          panel.id === targetId
            ? {
                ...panel,
                booleanModifiers: panel.booleanModifiers.filter(
                  (modifier) => modifier.id !== modifierId,
                ),
              }
            : panel.id === removed?.toolId && !toolStillUsed
              ? { ...panel, hidden: false }
              : panel,
        ),
        operationMessage:
          'Boolesche Operation entfernt; Werkzeug wieder eingeblendet.',
      }
    }),
  updateCut: (panelId, cutId, property, axis, value) =>
    set((state) => ({
      panels: state.panels.map((panel) =>
        panel.id !== panelId
          ? panel
          : {
              ...panel,
              cuts: panel.cuts.map((cut) => {
                if (cut.id !== cutId) return cut
                const vector: [number, number, number] = [...cut[property]]
                vector[axis] =
                  property === 'size' ? Math.max(0.1, value) : value
                return { ...cut, [property]: vector }
              }),
            },
      ),
    })),
  removeCut: (panelId, cutId) =>
    set((state) => {
      const owner = state.panels.find((panel) => panel.id === panelId)
      const cut = owner?.cuts.find((item) => item.id === cutId)
      return {
        panels: state.panels.map((panel) => ({
          ...panel,
          cuts: panel.cuts.filter(
            (item) =>
              item.id !== cutId &&
              (!cut?.jointId || item.jointId !== cut.jointId),
          ),
          jointFeatures: cut?.jointId
            ? panel.jointFeatures.filter(
                (feature) => feature.jointId !== cut.jointId,
              )
            : panel.jointFeatures,
        })),
        crossJoints: cut?.jointId
          ? state.crossJoints.filter((joint) => joint.id !== cut.jointId)
          : state.crossJoints,
        operationMessage: cut?.jointId
          ? 'Gekoppelte Steckverbindung entfernt.'
          : 'Aussparung entfernt.',
      }
    }),
  resizePanel: (id, size) =>
    set((state) => {
      const target = state.panels.find((panel) => panel.id === id)
      if (!target) return state
      const material = state.materials.find(
        (candidate) => candidate.id === target.materialId,
      )
      const lockedSize: [number, number, number] = [...size]
      lockedSize[thinAxis(target)] =
        material?.thickness ?? target.size[thinAxis(target)]
      const linked = linkedBooleanToolIds(id, state.panels)
      const factors: [number, number, number] = lockedSize.map(
        (value, axis) => value / target.size[axis],
      ) as [number, number, number]
      return {
        panels: state.panels.map((panel) => {
          if (panel.id === id) return { ...panel, size: lockedSize }
          if (!linked.has(panel.id)) return panel
          return {
            ...panel,
            size: panel.size.map((value, axis) =>
              Math.max(0.1, value * factors[axis]),
            ) as [number, number, number],
            position: panel.position.map(
              (value, axis) =>
                target.position[axis] +
                (value - target.position[axis]) * factors[axis],
            ) as [number, number, number],
          }
        }),
      }
    }),
  movePanel: (id, position) =>
    set((state) => {
      const moving = state.panels.find((panel) => panel.id === id)
      if (!moving) return state
      const linked = linkedBooleanToolIds(id, state.panels)
      const candidates = state.panels.filter(
        (panel) => panel.id !== id && !linked.has(panel.id) && !panel.hidden,
      )
      const snapped = state.snapEnabled
        ? snapPanelPosition(moving, position, candidates)
        : position
      const delta: [number, number, number] = snapped.map(
        (value, axis) => value - moving.position[axis],
      ) as [number, number, number]
      const moved = state.panels.map((panel) =>
        panel.id === id || linked.has(panel.id)
          ? {
              ...panel,
              position: panel.position.map(
                (value, axis) => value + delta[axis],
              ) as [number, number, number],
            }
          : panel,
      )
      const rebuilt = rebuildConnections(
        moved,
        state.fingerJoints,
        state.crossJoints,
        new Set([id, ...linked]),
      )
      return {
        panels: rebuilt.panels,
        fingerJoints: rebuilt.fingerJoints,
        crossJoints: rebuilt.crossJoints,
        operationMessage: rebuilt.failed.length
          ? `${rebuilt.failed.length} nicht mehr mögliche Verbindung(en) entfernt.`
          : undefined,
      }
    }),
  setPanelPosition: (id, position) =>
    set((state) => {
      const moving = state.panels.find((panel) => panel.id === id)
      if (!moving || position.some((value) => !Number.isFinite(value)))
        return state
      const linked = linkedBooleanToolIds(id, state.panels)
      const delta = position.map(
        (value, axis) => value - moving.position[axis],
      ) as [number, number, number]
      const moved = state.panels.map((panel) =>
        panel.id === id || linked.has(panel.id)
          ? {
              ...panel,
              position: panel.position.map(
                (value, axis) => value + delta[axis],
              ) as [number, number, number],
            }
          : panel,
      )
      const rebuilt = rebuildConnections(
        moved,
        state.fingerJoints,
        state.crossJoints,
        new Set([id, ...linked]),
      )
      return {
        panels: rebuilt.panels,
        fingerJoints: rebuilt.fingerJoints,
        crossJoints: rebuilt.crossJoints,
        operationMessage: rebuilt.failed.length
          ? `${rebuilt.failed.length} nicht mehr mögliche Verbindung(en) entfernt.`
          : undefined,
      }
    }),
  setSelectionPosition: (position) =>
    set((state) => {
      const selected = new Set(state.selectedPanels)
      const selectedPanels = state.panels.filter((panel) =>
        selected.has(panel.id),
      )
      if (
        !selectedPanels.length ||
        position.some((value) => !Number.isFinite(value))
      )
        return state
      const bounds = selectedPanels.reduce(
        (current, panel) => {
          const half = worldHalfExtents(panel)
          return {
            min: current.min.map((value, axis) =>
              Math.min(value, panel.position[axis] - half[axis]),
            ) as [number, number, number],
            max: current.max.map((value, axis) =>
              Math.max(value, panel.position[axis] + half[axis]),
            ) as [number, number, number],
          }
        },
        {
          min: [Infinity, Infinity, Infinity] as [number, number, number],
          max: [-Infinity, -Infinity, -Infinity] as [number, number, number],
        },
      )
      const center = bounds.min.map(
        (value, axis) => (value + bounds.max[axis]) / 2,
      ) as [number, number, number]
      const delta = position.map((value, axis) => value - center[axis]) as [
        number,
        number,
        number,
      ]
      const moved = state.panels.map((panel) =>
        selected.has(panel.id)
          ? {
              ...panel,
              position: panel.position.map(
                (value, axis) => value + delta[axis],
              ) as [number, number, number],
            }
          : panel,
      )
      const rebuilt = rebuildConnections(
        moved,
        state.fingerJoints,
        state.crossJoints,
        selected,
      )
      return {
        panels: rebuilt.panels,
        fingerJoints: rebuilt.fingerJoints,
        crossJoints: rebuilt.crossJoints,
        operationMessage: rebuilt.failed.length
          ? `${rebuilt.failed.length} nicht mehr mögliche Verbindung(en) entfernt.`
          : undefined,
      }
    }),
  rotatePanel: (id, rotation) =>
    set((state) => {
      const target = state.panels.find((panel) => panel.id === id)
      if (!target) return state
      const linked = linkedBooleanToolIds(id, state.panels)
      const oldQuaternion = new Quaternion().setFromEuler(
        new Euler(...target.rotation),
      )
      const newQuaternion = new Quaternion().setFromEuler(
        new Euler(...rotation),
      )
      const delta = newQuaternion
        .clone()
        .multiply(oldQuaternion.clone().invert())
      const pivot = new Vector3(...target.position)
      return {
        panels: state.panels.map((panel) => {
          if (panel.id === id) return { ...panel, rotation }
          if (!linked.has(panel.id)) return panel
          const position = new Vector3(...panel.position)
            .sub(pivot)
            .applyQuaternion(delta)
            .add(pivot)
          const panelRotation = delta
            .clone()
            .multiply(
              new Quaternion().setFromEuler(new Euler(...panel.rotation)),
            )
          const euler = new Euler().setFromQuaternion(panelRotation)
          return {
            ...panel,
            position: position.toArray() as [number, number, number],
            rotation: [euler.x, euler.y, euler.z],
          }
        }),
      }
    }),
  setSelectionHeight: (height) =>
    set((state) => {
      const selected = new Set(state.selectedPanels)
      const vertical = state.panels.find(
        (panel) => selected.has(panel.id) && thinAxis(panel) !== 1,
      )
      if (!vertical) return state
      const previousHeight = vertical.size[1]
      const delta = height - previousHeight
      return {
        panels: state.panels.map((panel) => {
          if (!selected.has(panel.id)) return panel
          if (thinAxis(panel) !== 1) {
            return {
              ...panel,
              size: [panel.size[0], height, panel.size[2]],
              position: [
                panel.position[0],
                panel.position[1] + delta / 2,
                panel.position[2],
              ],
            }
          }
          if (
            thinAxis(panel) === 1 &&
            panel.position[1] >= vertical.position[1]
          ) {
            return {
              ...panel,
              position: [
                panel.position[0],
                panel.position[1] + delta,
                panel.position[2],
              ],
            }
          }
          return panel
        }),
      }
    }),
  setTransformMode: (transformMode) => set({ transformMode }),
  setTransformConstraint: (transformConstraint) => set({ transformConstraint }),
  toggleSnap: () => set((state) => ({ snapEnabled: !state.snapEnabled })),
  setRotationStep: (rotationStep) =>
    set({ rotationStep: Math.max(0.1, rotationStep) }),
  setTranslationStep: (translationStep) =>
    set({ translationStep: Math.max(0.1, translationStep) }),
  setScaleStep: (scaleStep) => set({ scaleStep: Math.max(0.001, scaleStep) }),
  toggleTransformGrid: () =>
    set((state) => ({ transformGridEnabled: !state.transformGridEnabled })),
  setColorMode: (colorMode) => set({ colorMode }),
  setSelectionColor: (displayColor) =>
    set((state) =>
      state.selectedGroupId
        ? {
            groups: state.groups.map((group) =>
              group.id === state.selectedGroupId
                ? { ...group, displayColor }
                : group,
            ),
            colorMode: 'object',
          }
        : {
            panels: state.panels.map((panel) =>
              state.selectedPanels.includes(panel.id)
                ? { ...panel, displayColor }
                : panel,
            ),
            colorMode: 'object',
          },
    ),
  undo: () => {
    if (!historyPast.length) return
    const current = snapshotOf(useEditor.getState())
    const previous = historyPast.pop()!
    historyFuture.push(current)
    historyRestoring = true
    useEditor.setState({
      ...previous,
      canUndo: historyPast.length > 0,
      canRedo: true,
    })
    historyRestoring = false
  },
  redo: () => {
    if (!historyFuture.length) return
    const current = snapshotOf(useEditor.getState())
    const next = historyFuture.pop()!
    historyPast.push(current)
    historyRestoring = true
    useEditor.setState({
      ...next,
      canUndo: true,
      canRedo: historyFuture.length > 0,
    })
    historyRestoring = false
  },
  beginTransform: () => {
    if (!transformSnapshot) transformSnapshot = snapshotOf(useEditor.getState())
  },
  endTransform: () => {
    if (!transformSnapshot) return
    if (transformSnapshot.panels !== useEditor.getState().panels) {
      historyPast.push(transformSnapshot)
      historyFuture.length = 0
      useEditor.setState({ canUndo: true, canRedo: false })
    }
    transformSnapshot = null
  },
  setRotationPreview: (rotationPreview) => set({ rotationPreview }),
  setWorkspace: (workspace) => set({ workspace }),
  newProject: (template) => {
    const panels = template === 'box' ? createBoxPanels(defaultBox) : []
    const groups: ProjectGroup[] = panels.length
      ? [
          {
            id: 'group-1',
            name: 'Baugruppe 01',
            panelIds: panels.map((panel) => panel.id),
            visible: true,
          },
        ]
      : []
    historyRestoring = true
    historyPast.length = 0
    historyFuture.length = 0
    transformSnapshot = null
    nextPanelNumber = 1
    set({
      box: defaultBox,
      panels: panels.map((panel) => ({
        ...panel,
        autoCut: true,
        processingAssignments: [],
      })),
      groups,
      fingerJoints: [],
      crossJoints: [],
      laserTexts: [],
      selectedPanels: [],
      selectedGroupId: null,
      selectedTextId: null,
      contourSelection: null,
      workspace: 'model',
      transformMode: 'translate',
      transformConstraint: 'free',
      operationMessage:
        template === 'box'
          ? 'Neues Projekt mit Standardbox angelegt.'
          : 'Neues leeres Projekt angelegt.',
      canUndo: false,
      canRedo: false,
      rotationPreview: null,
      jointPreview: null,
    })
    historyRestoring = false
  },
  serializeProject: (): string =>
    JSON.stringify(projectDocumentOf(useEditor.getState()), null, 2),
  serializeGroup: (id): string => {
    const state = useEditor.getState()
    const group = state.groups.find((candidate) => candidate.id === id)
    if (!group) return ''
    const included = new Set(group.panelIds)
    const panels = state.panels
      .filter((panel) => included.has(panel.id))
      .map((panel) => ({
        ...panel,
        booleanModifiers: panel.booleanModifiers.filter((modifier) =>
          included.has(modifier.toolId),
        ),
      }))
    const current: ProjectState = {
      ...projectStateOf(state),
      panels,
      groups: [{ ...group, panelIds: panels.map((panel) => panel.id) }],
      selectedGroupId: group.id,
      selectedPanels: [],
      laserTexts: state.laserTexts.filter((text) => included.has(text.panelId)),
      fingerJoints: state.fingerJoints.filter(
        (joint) =>
          included.has(joint.firstPanelId) && included.has(joint.secondPanelId),
      ),
      crossJoints: state.crossJoints.filter(
        (joint) =>
          included.has(joint.firstPanelId) && included.has(joint.secondPanelId),
      ),
    }
    return JSON.stringify(
      {
        format: 'lasercut-studio',
        version: 1,
        savedAt: new Date().toISOString(),
        current,
        history: { past: [], future: [] },
      } satisfies ProjectDocument,
      null,
      2,
    )
  },
  loadProject: (contents) => {
    const document = parseProject(contents)
    if (!document) {
      set({
        operationMessage:
          'Projektdatei ist ungültig oder verwendet eine nicht unterstützte Version.',
      })
      return false
    }
    historyPast.splice(0, historyPast.length, ...document.history.past)
    historyFuture.splice(0, historyFuture.length, ...document.history.future)
    historyRestoring = true
    const missingFonts = missingFontFamilies(
      document.current.laserTexts.map((text) => text.fontFamily),
    )
    set({
      ...document.current,
      canUndo: historyPast.length > 0,
      canRedo: historyFuture.length > 0,
      operationMessage: missingFonts.length
        ? `Projekt geladen; ${missingFonts.length} Schriftart(en) fehlen.`
        : 'Projektdatei erfolgreich geladen.',
      rotationPreview: null,
      selectedTextId: null,
      missingFonts,
    })
    historyRestoring = false
    return true
  },
  updateExportLayer: (id, changes) =>
    set((state) => ({
      exportLayers: state.exportLayers.map((layer) =>
        layer.id === id ? { ...layer, ...changes } : layer,
      ),
    })),
  moveExportLayer: (id, direction) =>
    set((state) => {
      const sorted = [...state.exportLayers].sort((a, b) => a.order - b.order)
      const index = sorted.findIndex((layer) => layer.id === id)
      if (index < 0) return state
      const materialIndexes = sorted
        .map((layer, candidate) =>
          layer.materialId === sorted[index].materialId ? candidate : -1,
        )
        .filter((candidate) => candidate >= 0)
      const localIndex = materialIndexes.indexOf(index)
      const target = materialIndexes[localIndex + direction]
      if (target === undefined) return state
      const colors = sorted.map((layer) => layer.color)
      ;[sorted[index], sorted[target]] = [sorted[target], sorted[index]]
      return {
        exportLayers: sorted.map((layer, order) => ({
          ...layer,
          order,
          color: colors[order],
        })),
      }
    }),
  reorderExportLayer: (id, targetId, position = 'before') =>
    set((state) => {
      const sorted = [...state.exportLayers].sort((a, b) => a.order - b.order)
      const colors = sorted.map((layer) => layer.color)
      const from = sorted.findIndex((layer) => layer.id === id)
      const to = sorted.findIndex((layer) => layer.id === targetId)
      if (
        from < 0 ||
        to < 0 ||
        from === to ||
        sorted[from].materialId !== sorted[to].materialId
      )
        return state
      const materialSlots = sorted
        .map((layer, index) =>
          layer.materialId === sorted[from].materialId ? index : -1,
        )
        .filter((index) => index >= 0)
      const materialLayers = materialSlots.map((index) => sorted[index])
      const localFrom = materialLayers.findIndex((layer) => layer.id === id)
      const [moved] = materialLayers.splice(localFrom, 1)
      const targetAfterRemoval = materialLayers.findIndex(
        (layer) => layer.id === targetId,
      )
      const insertionIndex = targetAfterRemoval + (position === 'after' ? 1 : 0)
      materialLayers.splice(insertionIndex, 0, moved)
      materialSlots.forEach((slot, index) => {
        sorted[slot] = {
          ...materialLayers[index],
          order: slot,
          color: colors[slot],
        }
      })
      return { exportLayers: sorted }
    }),
  resetExportLayers: () =>
    set((state) => ({
      exportLayers: createDefaultExportLayers(state.materials),
      operationMessage:
        'Export-Layer auf sichere Standardreihenfolge zurückgesetzt.',
    })),
  addLaserCutter: (laser) =>
    set((state) => {
      const created = {
        ...laser,
        id: operationId('laser'),
        powerWatts: Math.max(1, laser.powerWatts),
      }
      const presets = createDefaultLaserPresets([created], state.materials)
      return {
        laserCutters: [...state.laserCutters, created],
        laserPresets: [...state.laserPresets, ...presets],
        activeLaserId: created.id,
        operationMessage: `${created.name} angelegt. Verwendete Bearbeitungsprofile müssen für diesen Laser nachgepflegt werden.`,
      }
    }),
  updateLaserCutter: (id, changes) =>
    set((state) => ({
      laserCutters: state.laserCutters.map((laser) =>
        laser.id === id
          ? {
              ...laser,
              ...changes,
              powerWatts:
                changes.powerWatts === undefined
                  ? laser.powerWatts
                  : Math.max(1, changes.powerWatts),
            }
          : laser,
      ),
    })),
  selectLaserCutter: (id) =>
    set((state) => {
      if (!state.laserCutters.some((laser) => laser.id === id)) return state
      const presets = state.laserPresets.filter(
        (preset) => preset.laserId === id,
      )
      return {
        activeLaserId: id,
        exportLayers: state.exportLayers.map((layer) => {
          const preset = presets.find(
            (candidate) =>
              candidate.materialId === layer.materialId &&
              candidate.operation === layer.operation,
          )
          return preset
            ? {
                ...layer,
                speed: preset.speed,
                power: preset.power,
                passes: preset.passes,
                airAssist: preset.airAssist,
                mode: preset.mode,
              }
            : layer
        }),
        operationMessage: 'Laserpresets auf die Exportlayer angewendet.',
      }
    }),
  updateLaserPreset: (id, changes) =>
    set((state) => {
      const preset = state.laserPresets.find((candidate) => candidate.id === id)
      if (!preset) return state
      const updated = { ...preset, ...changes }
      return {
        laserPresets: state.laserPresets.map((candidate) =>
          candidate.id === id ? updated : candidate,
        ),
        exportLayers:
          preset.laserId !== state.activeLaserId
            ? state.exportLayers
            : state.exportLayers.map((layer) =>
                layer.materialId === preset.materialId &&
                layer.operation === preset.operation
                  ? {
                      ...layer,
                      speed: updated.speed,
                      power: updated.power,
                      passes: updated.passes,
                      airAssist: updated.airAssist,
                      mode: updated.mode,
                    }
                  : layer,
              ),
      }
    }),
  updateStandardCut: (laserId, materialId, changes) =>
    set((state) => {
      const operations: LaserPreset['operation'][] = ['cut-inner', 'cut-outer']
      const existing = state.laserPresets.filter(
        (preset) =>
          preset.laserId === laserId &&
          preset.materialId === materialId &&
          operations.includes(preset.operation),
      )
      const fallback = existing[0]
      const nextPresets = state.laserPresets.map((preset) =>
        preset.laserId === laserId &&
        preset.materialId === materialId &&
        operations.includes(preset.operation)
          ? { ...preset, ...changes }
          : preset,
      )
      for (const operation of operations) {
        if (existing.some((preset) => preset.operation === operation)) continue
        nextPresets.push({
          id: crypto.randomUUID(),
          laserId,
          materialId,
          operation,
          mode: 'line',
          speed: fallback?.speed ?? 10,
          power: fallback?.power ?? 100,
          passes: fallback?.passes ?? 1,
          airAssist: fallback?.airAssist ?? true,
          ...changes,
        })
      }
      return { laserPresets: nextPresets }
    }),
  updateCutLayer: (laserId, materialId, operation, changes) =>
    set((state) => {
      const existing = state.laserPresets.find(
        (preset) =>
          preset.laserId === laserId &&
          preset.materialId === materialId &&
          preset.operation === operation,
      )
      const updated: LaserPreset = existing
        ? { ...existing, ...changes }
        : {
            id: operationId('preset'),
            laserId,
            materialId,
            operation,
            mode: 'line',
            speed: 10,
            power: 100,
            passes: 1,
            airAssist: true,
            layerColor: operation === 'cut-inner' ? '#00b000' : '#c0a000',
            ...changes,
          }
      return {
        laserPresets: existing
          ? state.laserPresets.map((preset) =>
              preset.id === existing.id ? updated : preset,
            )
          : [...state.laserPresets, updated],
        exportLayers:
          laserId !== state.activeLaserId
            ? state.exportLayers
            : state.exportLayers.map((layer) =>
                layer.materialId === materialId && layer.operation === operation
                  ? {
                      ...layer,
                      speed: updated.speed,
                      power: updated.power,
                      passes: updated.passes,
                      airAssist: updated.airAssist,
                      mode: updated.mode,
                      color: updated.layerColor ?? layer.color,
                    }
                  : layer,
              ),
      }
    }),
  addProcessingProfile: (profile) =>
    set((state) => {
      const created: ProcessingProfile = {
        ...profile,
        id: operationId('profile'),
        order: state.processingProfiles.length,
      }
      return {
        processingProfiles: [...state.processingProfiles, created],
        operationMessage: `Bearbeitungsprofil „${created.name}“ angelegt.`,
      }
    }),
  updateProcessingProfile: (id, changes) =>
    set((state) => ({
      processingProfiles: state.processingProfiles.map((profile) =>
        profile.id === id ? { ...profile, ...changes } : profile,
      ),
      panels: changes.geometry
        ? state.panels.map((panel) => ({
            ...panel,
            processingAssignments:
              panel.processingAssignments?.map((assignment) =>
                assignment.profileId === id
                  ? { ...assignment, geometry: changes.geometry! }
                  : assignment,
              ) ?? [],
          }))
        : state.panels,
    })),
  removeProcessingProfile: (id) =>
    set((state) => ({
      processingProfiles: state.processingProfiles.filter(
        (profile) => profile.id !== id,
      ),
      processingRecipes: state.processingRecipes.filter(
        (recipe) => recipe.profileId !== id,
      ),
      panels: state.panels.map((panel) => ({
        ...panel,
        processingAssignments:
          panel.processingAssignments?.filter(
            (assignment) => assignment.profileId !== id,
          ) ?? [],
      })),
      operationMessage:
        'Bearbeitungsprofil, Laserzuordnungen und Objektzuweisungen entfernt.',
    })),
  moveProcessingProfile: (id, direction) =>
    set((state) => {
      const source = state.processingProfiles.find(
        (profile) => profile.id === id,
      )
      if (!source) return state
      const siblings = [...state.processingProfiles].sort(
        (a, b) => a.order - b.order,
      )
      const index = siblings.findIndex((profile) => profile.id === id)
      const target = siblings[index + direction]
      if (!target) return state
      return {
        processingProfiles: state.processingProfiles.map((profile) =>
          profile.id === source.id
            ? { ...profile, order: target.order }
            : profile.id === target.id
              ? { ...profile, order: source.order }
              : profile,
        ),
      }
    }),
  addProcessingAssignment: (panelId, profileId) =>
    set((state) => {
      const profile = state.processingProfiles.find(
        (candidate) => candidate.id === profileId,
      )
      const panel = state.panels.find((candidate) => candidate.id === panelId)
      if (!profile || !panel)
        return { operationMessage: 'Bearbeitungsprofil oder Objekt fehlt.' }
      if (
        panel.processingAssignments?.some(
          (assignment) => assignment.profileId === profileId,
        )
      )
        return state
      return {
        panels: state.panels.map((candidate) =>
          candidate.id === panelId
            ? {
                ...candidate,
                processingAssignments: [
                  ...(candidate.processingAssignments ?? []),
                  {
                    id: operationId('assignment'),
                    profileId,
                    geometry: profile.geometry,
                  },
                ],
              }
            : candidate,
        ),
        operationMessage: `Profil „${profile.name}“ zugewiesen.`,
      }
    }),
  removeProcessingAssignment: (panelId, assignmentId) =>
    set((state) => ({
      panels: state.panels.map((panel) =>
        panel.id === panelId
          ? {
              ...panel,
              processingAssignments:
                panel.processingAssignments?.filter(
                  (assignment) => assignment.id !== assignmentId,
                ) ?? [],
            }
          : panel,
      ),
    })),
  setPanelAutoCut: (panelId, enabled) =>
    set((state) => ({
      panels: state.panels.map((panel) =>
        panel.id === panelId ? { ...panel, autoCut: enabled } : panel,
      ),
      operationMessage: enabled
        ? 'Automatische Schnittkonturen aktiviert.'
        : 'Objekt vom automatischen Schnitt ausgeschlossen.',
    })),
  updateProcessingRecipe: (profileId, laserId, materialId, changes) =>
    set((state) => {
      const existing = state.processingRecipes.find(
        (recipe) =>
          recipe.profileId === profileId &&
          recipe.laserId === laserId &&
          recipe.materialId === materialId,
      )
      const base: ProcessingRecipe = existing ?? {
        id: operationId('recipe'),
        profileId,
        laserId,
        materialId,
        speed: 100,
        power: 20,
        passes: 1,
        airAssist: false,
        lineInterval: 0.1,
        focusOffset: 0,
        layerColor:
          state.processingProfiles.find((profile) => profile.id === profileId)
            ?.color ?? '#d000d0',
      }
      const updated = {
        ...base,
        ...changes,
        speed: Math.max(0, changes.speed ?? base.speed),
        power: Math.min(100, Math.max(0, changes.power ?? base.power)),
        passes: Math.max(1, changes.passes ?? base.passes),
      }
      return {
        processingRecipes: existing
          ? state.processingRecipes.map((recipe) =>
              recipe.id === existing.id ? updated : recipe,
            )
          : [...state.processingRecipes, updated],
        operationMessage: 'Laserzuordnung gespeichert.',
      }
    }),
}))

if (restoredProject) {
  historyPast.push(...restoredProject.history.past.slice(-50))
  historyFuture.push(...restoredProject.history.future.slice(-50))
}

let autosaveTimer: ReturnType<typeof setTimeout> | null = null
useEditor.subscribe((state, previous) => {
  const persistedProjectChanged =
    state.panels !== previous.panels ||
    state.box !== previous.box ||
    state.materials !== previous.materials ||
    state.groups !== previous.groups ||
    state.fingerJoints !== previous.fingerJoints ||
    state.crossJoints !== previous.crossJoints ||
    state.laserTexts !== previous.laserTexts ||
    state.exportLayers !== previous.exportLayers ||
    state.laserCutters !== previous.laserCutters ||
    state.laserPresets !== previous.laserPresets ||
    state.processingProfiles !== previous.processingProfiles ||
    state.processingRecipes !== previous.processingRecipes ||
    state.activeLaserId !== previous.activeLaserId ||
    state.colorMode !== previous.colorMode
  if (typeof localStorage !== 'undefined' && persistedProjectChanged) {
    if (autosaveTimer) clearTimeout(autosaveTimer)
    autosaveTimer = setTimeout(
      () => persistCompactAutosave(useEditor.getState()),
      750,
    )
  }
  if (historyRestoring || transformSnapshot) return
  if (
    state.panels !== previous.panels ||
    state.box !== previous.box ||
    state.materials !== previous.materials ||
    state.groups !== previous.groups
  ) {
    historyPast.push(snapshotOf(previous))
    if (historyPast.length > 100) historyPast.shift()
    historyFuture.length = 0
    if (!state.canUndo || state.canRedo)
      useEditor.setState({ canUndo: true, canRedo: false })
  }
})

if (typeof localStorage !== 'undefined') {
  persistCompactAutosave(useEditor.getState())
}
