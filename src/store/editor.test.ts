import { beforeEach, describe, expect, it } from 'vitest'
import { createBoxPanels, defaultBox, defaultMaterials } from '../model/box'
import { worldHalfExtents } from '../model/snapping'
import {
  createDefaultExportLayers,
  createDefaultLaserPresets,
  createDefaultProcessingProfiles,
  createDefaultProcessingRecipes,
  defaultLaserCutters,
} from '../model/export'
import { useEditor } from './editor'

beforeEach(() => {
  const processingProfiles = createDefaultProcessingProfiles()
  useEditor.setState({
    box: defaultBox,
    panels: createBoxPanels(defaultBox),
    materials: defaultMaterials,
    groups: [
      {
        id: 'group-1',
        name: 'Baugruppe 01',
        panelIds: createBoxPanels(defaultBox).map((panel) => panel.id),
        visible: true,
      },
    ],
    selectedGroupId: null,
    selectedTextId: null,
    fingerJoints: [],
    crossJoints: [],
    laserTexts: [],
    exportLayers: createDefaultExportLayers(defaultMaterials),
    laserCutters: defaultLaserCutters,
    laserPresets: createDefaultLaserPresets(
      defaultLaserCutters,
      defaultMaterials,
    ),
    processingProfiles,
    processingRecipes: createDefaultProcessingRecipes(
      processingProfiles,
      defaultLaserCutters,
      defaultMaterials,
    ),
    activeLaserId: defaultLaserCutters[0].id,
    selectedPanels: [],
    operationMessage: null,
    snapEnabled: false,
    transformGridEnabled: false,
  })
})

describe('editor object operations', () => {
  it('starts clean empty and standard-box projects with cleared history', () => {
    useEditor.getState().addShape('circle')
    useEditor.getState().newProject('empty')
    expect(useEditor.getState().panels).toEqual([])
    expect(useEditor.getState().groups).toEqual([])
    expect(useEditor.getState().canUndo).toBe(false)
    useEditor.getState().undo()
    expect(useEditor.getState().panels).toEqual([])
    useEditor.getState().newProject('box')
    expect(useEditor.getState().panels).toHaveLength(6)
    expect(useEditor.getState().groups).toHaveLength(1)
    expect(useEditor.getState().selectedPanels).toEqual([])
  })
  it('imports SVG contours as material-aware groups and undoes the import atomically', () => {
    const beforeCount = useEditor.getState().panels.length
    useEditor.getState().importSvgObjects('Schild', [
      {
        name: 'Außenring',
        groupName: 'Front',
        materialId: 'acrylic-3',
        faces: [
          {
            id: 'face',
            outer: [
              [0, 0],
              [60, 0],
              [60, 30],
              [0, 30],
            ],
            holes: [
              [
                [10, 10],
                [10, 20],
                [20, 20],
                [20, 10],
              ],
            ],
          },
        ],
      },
      {
        name: 'Einleger',
        groupName: 'Dekor',
        materialId: 'birch-5',
        faces: [
          {
            id: 'face',
            outer: [
              [70, 0],
              [90, 0],
              [90, 20],
              [70, 20],
            ],
            holes: [],
          },
        ],
      },
    ])
    const imported = useEditor.getState().panels.slice(beforeCount)
    expect(imported).toHaveLength(2)
    expect(
      imported.map((panel) => [panel.label, panel.materialId, panel.size[2]]),
    ).toEqual([
      ['Außenring', 'acrylic-3', 3],
      ['Einleger', 'birch-5', 5],
    ])
    expect(imported[0].position).toEqual([-15, 0, 0])
    expect(imported[1].position).toEqual([35, -5, 0])
    expect(
      imported[0].shape?.type === 'free'
        ? imported[0].shape.faces[0].outer
        : [],
    ).toEqual([
      [-30, -15],
      [30, -15],
      [30, 15],
      [-30, 15],
    ])
    expect(
      useEditor
        .getState()
        .groups.slice(-2)
        .map((group) => group.name),
    ).toEqual(['Front', 'Dekor'])
    expect(useEditor.getState().selectedPanels).toEqual([imported[0].id])
    expect(useEditor.getState().selectedGroupId).toBeNull()
    useEditor.getState().undo()
    expect(useEditor.getState().panels).toHaveLength(beforeCount)
  })
  it('rotates and uniformly scales a group while preserving material thickness', () => {
    useEditor.setState({
      selectedPanels: ['front', 'back'],
      selectedGroupId: 'group-1',
    })
    const before = useEditor
      .getState()
      .panels.find((panel) => panel.id === 'front')!
    useEditor
      .getState()
      .transformSelectedGroup([0, 0, 0], [0, 0, 0], [0, Math.PI / 2, 0], 2)
    const after = useEditor
      .getState()
      .panels.find((panel) => panel.id === 'front')!
    expect(after.position[0]).toBeCloseTo(before.position[2] * 2)
    expect(after.position[2]).toBeCloseTo(0)
    expect(after.size).toEqual([
      before.size[0] * 2,
      before.size[1] * 2,
      before.size[2],
    ])
    expect(after.rotation[1]).toBeCloseTo(Math.PI / 2)
  })
  it('adds text through the same regular shape-object path as other primitives', () => {
    useEditor.getState().addShape('text')
    const created = useEditor.getState().panels.at(-1)!
    expect(created.shape).toMatchObject({
      type: 'text',
      text: 'Text',
      operation: 'cut',
    })
    expect(useEditor.getState().selectedPanels).toEqual([created.id])
    expect(useEditor.getState().laserTexts).toEqual([])
  })
  it('treats laser text as an independently selectable and removable scene object', () => {
    useEditor.getState().addLaserText('front')
    const text = useEditor.getState().laserTexts[0]
    expect(useEditor.getState().selectedTextId).toBe(text.id)
    expect(useEditor.getState().selectedPanels).toEqual([])
    useEditor.getState().selectPanel('front')
    expect(useEditor.getState().selectedTextId).toBeNull()
    useEditor.getState().selectLaserText(text.id)
    useEditor.getState().removeSelected()
    expect(useEditor.getState().laserTexts).toEqual([])
    expect(
      useEditor.getState().panels.some((panel) => panel.id === 'front'),
    ).toBe(true)
  })
  const assemblyBounds = () =>
    useEditor.getState().panels.reduce(
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
  it('adds and toggles objects in a multiple selection', () => {
    useEditor.getState().selectPanel('front')
    useEditor.getState().selectPanel('left', true)
    useEditor.getState().selectPanel('front', true)
    expect(useEditor.getState().selectedPanels).toEqual(['left'])
  })

  it('sets and additively extends a rubberband-style multiple selection atomically', () => {
    useEditor.getState().selectPanels(['front', 'left'])
    expect(useEditor.getState().selectedPanels).toEqual(['front', 'left'])
    useEditor.getState().selectPanels(['right', 'missing'], true)
    expect(useEditor.getState().selectedPanels).toEqual([
      'front',
      'left',
      'right',
    ])
    expect(useEditor.getState().selectedGroupId).toBeNull()
  })

  it('sets an exact object position without applying mouse snapping', () => {
    useEditor.setState({ snapEnabled: true })
    const front = useEditor
      .getState()
      .panels.find((panel) => panel.id === 'front')!
    useEditor
      .getState()
      .setPanelPosition('front', [0.01, -0.02, front.position[2] + 0.005])
    expect(
      useEditor.getState().panels.find((panel) => panel.id === 'front')!
        .position,
    ).toEqual([0.01, -0.02, front.position[2] + 0.005])
  })

  it('sets the exact shared gizmo position of a multiple selection', () => {
    useEditor.setState({ selectedPanels: ['front', 'back'], snapEnabled: true })
    const before = useEditor
      .getState()
      .panels.filter((panel) => panel.id === 'front' || panel.id === 'back')
    const relativeZ = before[1].position[2] - before[0].position[2]
    useEditor.getState().setSelectionPosition([10.01, -5.02, 3.005])
    const after = useEditor
      .getState()
      .panels.filter((panel) => panel.id === 'front' || panel.id === 'back')
    const half = after.map((panel) => worldHalfExtents(panel))
    const min = [0, 1, 2].map((axis) =>
      Math.min(
        ...after.map(
          (panel, index) => panel.position[axis] - half[index][axis],
        ),
      ),
    )
    const max = [0, 1, 2].map((axis) =>
      Math.max(
        ...after.map(
          (panel, index) => panel.position[axis] + half[index][axis],
        ),
      ),
    )
    min
      .map((value, axis) => (value + max[axis]) / 2)
      .forEach((value, axis) =>
        expect(value).toBeCloseTo([10.01, -5.02, 3.005][axis]),
      )
    expect(after[1].position[2] - after[0].position[2]).toBe(relativeZ)
  })

  it('stores independent object and assembly display colors without changing materials', () => {
    const materialId = useEditor
      .getState()
      .panels.find((panel) => panel.id === 'front')!.materialId
    useEditor.setState({ selectedPanels: ['front'], selectedGroupId: null })
    useEditor.getState().setSelectionColor('#123456')
    expect(
      useEditor.getState().panels.find((panel) => panel.id === 'front'),
    ).toMatchObject({ materialId, displayColor: '#123456' })
    expect(useEditor.getState().colorMode).toBe('object')
    useEditor.getState().selectGroup('group-1')
    useEditor.getState().setSelectionColor('#abcdef')
    expect(useEditor.getState().groups[0].displayColor).toBe('#abcdef')
    const saved = useEditor.getState().serializeProject()
    useEditor.getState().setColorMode('material')
    expect(useEditor.getState().loadProject(saved)).toBe(true)
    expect(useEditor.getState().colorMode).toBe('object')
    expect(useEditor.getState().groups[0].displayColor).toBe('#abcdef')
  })

  it('duplicates one object inside its existing group and selects the copy', () => {
    useEditor.setState({ selectedPanels: ['front'] })
    const original = useEditor
      .getState()
      .panels.find((panel) => panel.id === 'front')!
    useEditor.getState().duplicateSelected()
    const copy = useEditor.getState().panels.at(-1)!
    expect(copy).toMatchObject({
      label: 'Vorderseite Kopie',
      materialId: original.materialId,
      size: original.size,
      rotation: original.rotation,
    })
    expect(copy.position).toEqual(original.position)
    expect(useEditor.getState().groups[0].panelIds).toContain(copy.id)
    expect(useEditor.getState().selectedPanels).toEqual([copy.id])
  })

  it('duplicates a multiple selection with its internal connection', () => {
    useEditor.setState({ selectedPanels: ['front', 'left'] })
    useEditor.getState().createFingerJoint({
      connectionType: 'finger',
      fingerWidth: 12,
      fit: 'tight',
      clearance: 0,
      style: 'straight',
      reliefDiameter: 1,
    })
    useEditor.getState().duplicateSelected()
    const copies = useEditor.getState().selectedPanels
    expect(copies).toHaveLength(2)
    const copiedJoint = useEditor.getState().fingerJoints.at(-1)!
    expect(copies).toContain(copiedJoint.firstPanelId)
    expect(copies).toContain(copiedJoint.secondPanelId)
  })

  it('duplicates one connected plate and adds another cut to the stationary receiver', () => {
    useEditor.getState().addPanel()
    const divider = useEditor.getState().panels.at(-1)!
    useEditor.getState().movePanel(divider.id, [-40, 0, 0])
    useEditor.getState().addPanel()
    const receiver = useEditor.getState().panels.at(-1)!
    useEditor.getState().resizePanel(receiver.id, [80, 200, 3])
    useEditor.getState().rotatePanel(receiver.id, [0, Math.PI / 2, 0])
    useEditor.setState({ selectedPanels: [divider.id, receiver.id] })
    useEditor.getState().createCrossJoint({
      ratio: 0.5,
      fit: 'tight',
      clearance: 0,
      firstFromHigh: true,
    })
    const originalJointId = useEditor.getState().crossJoints[0].id

    useEditor.setState({ selectedPanels: [divider.id] })
    useEditor.getState().duplicateSelected()
    const copyId = useEditor.getState().selectedPanels[0]
    const duplicated = useEditor.getState()
    expect(duplicated.crossJoints).toHaveLength(2)
    expect(
      duplicated.crossJoints.some(
        (joint) =>
          joint.firstPanelId === copyId && joint.secondPanelId === receiver.id,
      ),
    ).toBe(true)
    expect(
      duplicated.panels.find((panel) => panel.id === receiver.id)!.cuts,
    ).toHaveLength(2)
    const untouchedOriginalCutId = duplicated.panels
      .find((panel) => panel.id === receiver.id)!
      .cuts.find((cut) => cut.jointId === originalJointId)!.id

    useEditor.getState().movePanel(copyId, [-40, 5, 0])
    const moved = useEditor.getState()
    const receiverCuts = moved.panels.find(
      (panel) => panel.id === receiver.id,
    )!.cuts
    const originalCut = receiverCuts.find(
      (cut) => cut.jointId === originalJointId,
    )!
    const copiedCut = receiverCuts.find(
      (cut) => cut.jointId !== originalJointId,
    )!
    expect(receiverCuts).toHaveLength(2)
    expect(originalCut.id).toBe(untouchedOriginalCutId)
    expect(copiedCut.center[1] - originalCut.center[1]).toBeCloseTo(5)
  })

  it('moves an existing connected cut from its old position to its new position', () => {
    useEditor.getState().addPanel()
    const divider = useEditor.getState().panels.at(-1)!
    useEditor.getState().movePanel(divider.id, [-40, 0, 0])
    useEditor.getState().addPanel()
    const receiver = useEditor.getState().panels.at(-1)!
    useEditor.getState().resizePanel(receiver.id, [80, 200, 3])
    useEditor.getState().rotatePanel(receiver.id, [0, Math.PI / 2, 0])
    useEditor.setState({ selectedPanels: [divider.id, receiver.id] })
    useEditor
      .getState()
      .createCrossJoint({ ratio: 0.5, fit: 'tight', clearance: 0 })
    const before = useEditor
      .getState()
      .panels.find((panel) => panel.id === receiver.id)!.cuts[0]

    useEditor.getState().movePanel(divider.id, [-40, 5, 0])

    const afterCuts = useEditor
      .getState()
      .panels.find((panel) => panel.id === receiver.id)!.cuts
    expect(afterCuts).toHaveLength(1)
    expect(afterCuts[0].jointId).toBe(before.jointId)
    expect(afterCuts[0].center[1] - before.center[1]).toBeCloseTo(5)
  })

  it('creates, renames and moves a real project group as one rigid selection', () => {
    useEditor.setState({ selectedPanels: ['front', 'left'] })
    useEditor.getState().createGroup()
    const group = useEditor.getState().groups.at(-1)!
    useEditor.getState().renameGroup(group.id, 'Frontmodul')
    useEditor.getState().selectGroup(group.id)
    const before = useEditor
      .getState()
      .panels.filter((panel) => group.panelIds.includes(panel.id))
      .map((panel) => panel.position)
    useEditor.getState().moveSelectedBy([25, -10, 5])
    const after = useEditor
      .getState()
      .panels.filter((panel) => group.panelIds.includes(panel.id))
      .map((panel) => panel.position)
    expect(
      useEditor.getState().groups.find((candidate) => candidate.id === group.id)
        ?.name,
    ).toBe('Frontmodul')
    expect(after).toEqual(
      before.map((position) => [
        position[0] + 25,
        position[1] - 10,
        position[2] + 5,
      ]),
    )
  })

  it('serializes a group as a standalone loadable project', () => {
    useEditor.setState({ selectedPanels: ['front', 'left'] })
    useEditor.getState().createGroup()
    const group = useEditor.getState().groups.at(-1)!
    useEditor.getState().renameGroup(group.id, 'Teilprojekt')
    const file = useEditor.getState().serializeGroup(group.id)
    expect(useEditor.getState().loadProject(file)).toBe(true)
    expect(
      useEditor
        .getState()
        .panels.map((panel) => panel.id)
        .sort(),
    ).toEqual(['front', 'left'])
    expect(useEditor.getState().groups).toEqual([
      { ...group, name: 'Teilprojekt', panelIds: ['front', 'left'] },
    ])
  })

  it('uses the assembly eye to reveal all individually hidden children', () => {
    useEditor.getState().togglePanelVisibility('front')
    expect(
      useEditor.getState().panels.find((panel) => panel.id === 'front')
        ?.visible,
    ).toBe(false)
    expect(
      useEditor.getState().panels.find((panel) => panel.id === 'left')?.visible,
    ).toBe(true)
    useEditor.getState().toggleGroupVisibility('group-1')
    expect(useEditor.getState().groups[0].visible).toBe(true)
    expect(
      useEditor.getState().panels.find((panel) => panel.id === 'front')
        ?.visible,
    ).toBe(true)
    useEditor.getState().toggleGroupVisibility('group-1')
    expect(useEditor.getState().groups[0].visible).toBe(false)
    useEditor.getState().toggleGroupVisibility('group-1')
    expect(useEditor.getState().groups[0].visible).toBe(true)
    expect(
      useEditor.getState().panels.find((panel) => panel.id === 'front')
        ?.visible,
    ).toBe(true)
  })

  it('duplicates and deletes a complete assembly with independent objects', () => {
    useEditor.setState({ selectedPanels: ['front', 'left'] })
    useEditor.getState().createGroup()
    const source = useEditor.getState().groups.at(-1)!
    useEditor.getState().createFingerJoint({
      connectionType: 'finger',
      fingerWidth: 12,
      fit: 'tight',
      clearance: 0,
      style: 'straight',
      reliefDiameter: 1,
    })
    useEditor.getState().duplicateGroup(source.id)
    const copy = useEditor.getState().groups.at(-1)!
    expect(copy.name).toContain('Kopie')
    expect(copy.panelIds).toHaveLength(2)
    expect(copy.panelIds.some((id) => source.panelIds.includes(id))).toBe(false)
    expect(useEditor.getState().fingerJoints).toHaveLength(2)
    const copyFront = useEditor
      .getState()
      .panels.find((panel) => panel.id === copy.panelIds[0])!
    const sourceFront = useEditor
      .getState()
      .panels.find((panel) => panel.id === source.panelIds[0])!
    expect(copyFront.position).toEqual([
      sourceFront.position[0] + 20,
      sourceFront.position[1],
      sourceFront.position[2] + 20,
    ])
    useEditor.getState().deleteGroup(copy.id)
    expect(
      useEditor.getState().groups.some((group) => group.id === copy.id),
    ).toBe(false)
    expect(
      useEditor
        .getState()
        .panels.some((panel) => copy.panelIds.includes(panel.id)),
    ).toBe(false)
    expect(useEditor.getState().fingerJoints).toHaveLength(1)
  })

  it('removes selected panels without rebuilding the whole box', () => {
    useEditor.getState().selectPanel('top')
    useEditor.getState().removeSelected()
    expect(useEditor.getState().panels.map((panel) => panel.id)).not.toContain(
      'top',
    )
    expect(useEditor.getState().panels).toHaveLength(5)
  })

  it('grows selected walls upward and moves a selected lid to the new top edge', () => {
    useEditor.setState({ selectedPanels: ['front', 'left', 'right', 'top'] })
    const oldTop = useEditor
      .getState()
      .panels.find((panel) => panel.id === 'top')!.position[1]
    useEditor.getState().setSelectionHeight(150)
    const state = useEditor.getState()
    expect(state.panels.find((panel) => panel.id === 'front')!.size[1]).toBe(
      150,
    )
    expect(state.panels.find((panel) => panel.id === 'back')!.size[1]).toBe(120)
    expect(state.panels.find((panel) => panel.id === 'top')!.position[1]).toBe(
      oldTop + 30,
    )
  })

  it('moves a panel without changing any of its dimensions', () => {
    const before = useEditor
      .getState()
      .panels.find((panel) => panel.id === 'left')!
    useEditor.getState().movePanel('left', [-120, 15, 8])
    const after = useEditor
      .getState()
      .panels.find((panel) => panel.id === 'left')!
    expect(after.position).toEqual([-120, 15, 8])
    expect(after.size).toEqual(before.size)
  })

  it('stores exact object rotations and configurable transform grids', () => {
    useEditor.getState().rotatePanel('front', [Math.PI / 6, 0, 0])
    useEditor.getState().setRotationStep(5)
    useEditor.getState().setTranslationStep(2.5)
    useEditor.getState().setScaleStep(0.1)
    useEditor.getState().toggleTransformGrid()
    expect(
      useEditor.getState().panels.find((panel) => panel.id === 'front')!
        .rotation[0],
    ).toBeCloseTo(Math.PI / 6)
    expect(useEditor.getState().rotationStep).toBe(5)
    expect(useEditor.getState().translationStep).toBe(2.5)
    expect(useEditor.getState().scaleStep).toBe(0.1)
    expect(useEditor.getState().transformGridEnabled).toBe(true)
  })

  it('creates independent plates in selectable construction planes', () => {
    const count = useEditor.getState().panels.length
    useEditor.getState().addPanel()
    const panel = useEditor.getState().panels.at(-1)!
    expect(useEditor.getState().panels).toHaveLength(count + 1)
    expect(panel.size).toEqual([80, 100, 3])
    expect(useEditor.getState().selectedPanels).toEqual([panel.id])
  })

  it('assigns a thicker material inward while preserving the exterior face', () => {
    const before = useEditor
      .getState()
      .panels.find((panel) => panel.id === 'left')!
    const outsideBefore = before.position[0] - before.size[0] / 2
    useEditor.setState({ selectedPanels: ['left'] })
    useEditor.getState().assignMaterial('birch-5')
    const after = useEditor
      .getState()
      .panels.find((panel) => panel.id === 'left')!
    expect(after.materialId).toBe('birch-5')
    expect(after.size[0]).toBe(5)
    expect(after.position[0] - after.size[0] / 2).toBe(outsideBefore)
    expect(after.position[1]).toBe(before.position[1])
    expect(after.position[2]).toBe(before.position[2])
    expect(after.size[1]).toBe(before.size[1])
    expect(after.size[2]).toBe(before.size[2])
    expect(after.rotation).toEqual(before.rotation)
  })

  it('assigns a material to the complete box when no object is selected', () => {
    useEditor.getState().assignMaterial('birch-5')
    expect(
      useEditor
        .getState()
        .panels.every((panel) => panel.materialId === 'birch-5'),
    ).toBe(true)
    expect(
      useEditor
        .getState()
        .panels.every(
          (panel) =>
            panel.size[panel.size.indexOf(Math.min(...panel.size))] === 5,
        ),
    ).toBe(true)
    expect(useEditor.getState().box.thickness).toBe(5)
    useEditor.getState().setDimension('width', 200)
    expect(
      useEditor
        .getState()
        .panels.every((panel) => panel.materialId === 'birch-5'),
    ).toBe(true)
  })

  it('locks the thin object axis to the assigned material thickness when resizing', () => {
    const front = useEditor
      .getState()
      .panels.find((panel) => panel.id === 'front')!
    useEditor.getState().resizePanel('front', [90, 70, 25])
    expect(
      useEditor.getState().panels.find((panel) => panel.id === 'front')!.size,
    ).toEqual([90, 70, front.size[2]])
  })

  it('rejects direct box thickness changes', () => {
    useEditor.getState().setDimension('thickness', 12)
    expect(useEditor.getState().box.thickness).toBe(3)
    expect(
      useEditor
        .getState()
        .panels.every((panel) => Math.min(...panel.size) === 3),
    ).toBe(true)
  })

  it('selects primitive faces and edges without a manual contour conversion step', () => {
    expect(
      useEditor.getState().panels.find((panel) => panel.id === 'front')!.shape,
    ).toBeUndefined()
    useEditor.getState().selectContourFace('front', 0, -1, 0)
    expect(
      useEditor.getState().panels.find((panel) => panel.id === 'front')!.shape
        ?.type,
    ).toBe('free')
    expect(useEditor.getState().contourSelection).toEqual({
      panelId: 'front',
      faceIndex: 0,
      ringIndex: -1,
      edgeIndex: 0,
      kind: 'face',
    })
  })

  it('moves both corners of a selected side face but only one corner of a selected edge', () => {
    useEditor.getState().selectContourFace('front', 0, -1, 0)
    const beforeFace = useEditor
      .getState()
      .panels.find((panel) => panel.id === 'front')!.shape
    if (beforeFace?.type !== 'free') throw new Error('expected free contour')
    const original = beforeFace.faces[0].outer.map((point) => [...point])
    useEditor.getState().moveSelectedContour([2, 3])
    const afterFace = useEditor
      .getState()
      .panels.find((panel) => panel.id === 'front')!.shape
    if (afterFace?.type !== 'free') throw new Error('expected free contour')
    expect(afterFace.faces[0].outer[0]).toEqual([
      original[0][0] + 2,
      original[0][1] + 3,
    ])
    expect(afterFace.faces[0].outer[1]).toEqual([
      original[1][0] + 2,
      original[1][1] + 3,
    ])
    expect(afterFace.faces[0].outer[2]).toEqual(original[2])

    useEditor.getState().selectContourEdge('front', 0, -1, 2)
    useEditor.getState().moveSelectedContour([4, -1])
    const afterEdge = useEditor
      .getState()
      .panels.find((panel) => panel.id === 'front')!.shape
    if (afterEdge?.type !== 'free') throw new Error('expected free contour')
    expect(afterEdge.faces[0].outer[2]).toEqual([
      original[2][0] + 4,
      original[2][1] - 1,
    ])
    expect(afterEdge.faces[0].outer[3]).toEqual(original[3])
  })

  it('keeps the complete box exterior fixed when all panels change from 3 mm to 5 mm', () => {
    const before = assemblyBounds()
    useEditor.setState({
      selectedPanels: useEditor.getState().panels.map((panel) => panel.id),
    })
    useEditor.getState().assignMaterial('birch-5')
    expect(assemblyBounds()).toEqual(before)
    const state = useEditor.getState()
    expect(state.panels.find((panel) => panel.id === 'top')!.size).toEqual([
      170, 5, 90,
    ])
    expect(state.panels.find((panel) => panel.id === 'bottom')!.size).toEqual([
      170, 5, 90,
    ])
    expect(state.panels.find((panel) => panel.id === 'left')!.size).toEqual([
      5, 120, 90,
    ])
    expect(state.panels.find((panel) => panel.id === 'right')!.size).toEqual([
      5, 120, 90,
    ])
  })

  it('moves an adjacent inset boundary with a thicker wall instead of overlapping it', () => {
    const topBefore = useEditor
      .getState()
      .panels.find((panel) => panel.id === 'top')!
    expect(topBefore.position[0] - topBefore.size[0] / 2).toBe(-87)
    useEditor.setState({ selectedPanels: ['left'] })
    useEditor.getState().assignMaterial('birch-5')
    const state = useEditor.getState()
    const left = state.panels.find((panel) => panel.id === 'left')!
    const top = state.panels.find((panel) => panel.id === 'top')!
    const bottom = state.panels.find((panel) => panel.id === 'bottom')!
    const newInnerFace = left.position[0] + left.size[0] / 2
    expect(top.position[0] - top.size[0] / 2).toBe(newInnerFace)
    expect(bottom.position[0] - bottom.size[0] / 2).toBe(newInnerFace)
    expect(top.size[0]).toBe(172)
  })

  it('rebuilds existing joints when a connected object changes from 3 mm to 5 mm', () => {
    useEditor.setState({ selectedPanels: ['front', 'left'] })
    useEditor.getState().createFingerJoint({
      connectionType: 'finger',
      fingerWidth: 12,
      fit: 'tight',
      clearance: 0,
      style: 'dogbone',
      reliefDiameter: 1,
    })
    const before = useEditor.getState()
    const leftBefore = before.panels.find((panel) => panel.id === 'left')!
    const oldFeatures = before.panels
      .find((panel) => panel.id === 'front')!
      .jointFeatures.map((feature) => feature.id)
    useEditor.setState({ selectedPanels: ['left'] })
    useEditor.getState().assignMaterial('birch-5')
    const after = useEditor.getState()
    const leftAfter = after.panels.find((panel) => panel.id === 'left')!
    expect(after.fingerJoints).toHaveLength(1)
    expect(leftAfter.size[0]).toBe(5)
    expect(leftAfter.position[0] - leftAfter.size[0] / 2).toBe(
      leftBefore.position[0] - leftBefore.size[0] / 2,
    )
    expect(leftAfter.rotation).toEqual(leftBefore.rotation)
    expect(
      after.panels
        .find((panel) => panel.id === 'front')!
        .jointFeatures.map((feature) => feature.id),
    ).not.toEqual(oldFeatures)
  })

  it('resizes finger tabs and slots when every connected object changes from 3 mm to 5 mm', () => {
    useEditor.setState({ selectedPanels: ['front', 'left'] })
    useEditor.getState().createFingerJoint({
      connectionType: 'finger',
      fingerWidth: 12,
      fit: 'tight',
      clearance: 0,
      style: 'straight',
      reliefDiameter: 1,
    })
    useEditor.setState({
      selectedPanels: useEditor.getState().panels.map((panel) => panel.id),
    })
    useEditor.getState().assignMaterial('birch-5')

    const state = useEditor.getState()
    const front = state.panels.find((panel) => panel.id === 'front')!
    const left = state.panels.find((panel) => panel.id === 'left')!
    const frontTab = front.jointFeatures.find(
      (feature) => feature.operation === 'add',
    )!
    const leftSlot = left.jointFeatures.find(
      (feature) => feature.operation === 'subtract',
    )!
    expect(frontTab.size[0]).toBe(5)
    expect(frontTab.size[2]).toBe(5)
    expect(leftSlot.size[0]).toBe(7)
    expect(leftSlot.size[2]).toBe(5)
  })

  it('resizes existing finger tabs and slots after editing a used material thickness', () => {
    useEditor.setState({ selectedPanels: ['front', 'left'] })
    useEditor.getState().createFingerJoint({
      connectionType: 'finger',
      fingerWidth: 12,
      fit: 'tight',
      clearance: 0,
      style: 'straight',
      reliefDiameter: 1,
    })
    useEditor.getState().updateMaterial('birch-3', { thickness: 5 })

    const state = useEditor.getState()
    const frontTab = state.panels
      .find((panel) => panel.id === 'front')!
      .jointFeatures.find((feature) => feature.operation === 'add')!
    const leftSlot = state.panels
      .find((panel) => panel.id === 'left')!
      .jointFeatures.find((feature) => feature.operation === 'subtract')!
    expect(frontTab.size[0]).toBe(5)
    expect(frontTab.size[2]).toBe(5)
    expect(leftSlot.size[0]).toBe(7)
    expect(leftSlot.size[2]).toBe(5)
  })

  it('stores a non-destructive boolean and hides its tool', () => {
    useEditor.setState({ selectedPanels: ['front', 'left'] })
    useEditor.getState().applyBoolean('subtract')
    const state = useEditor.getState()
    expect(
      state.panels.find((panel) => panel.id === 'front')!.booleanModifiers[0],
    ).toMatchObject({ operation: 'subtract', toolId: 'left', enabled: true })
    expect(state.panels.find((panel) => panel.id === 'left')!.hidden).toBe(true)
    expect(state.selectedPanels).toEqual(['front'])
  })

  it('swaps target and tool and restores the tool when removing a boolean', () => {
    useEditor.setState({ selectedPanels: ['front', 'left'] })
    useEditor.getState().swapSelectionOrder()
    expect(useEditor.getState().selectedPanels).toEqual(['left', 'front'])
    useEditor.getState().applyBoolean('union')
    const modifier = useEditor
      .getState()
      .panels.find((panel) => panel.id === 'left')!.booleanModifiers[0]
    useEditor.getState().removeBoolean('left', modifier.id)
    expect(
      useEditor.getState().panels.find((panel) => panel.id === 'front')!.hidden,
    ).toBe(false)
  })

  it('moves a boolean result and all linked tools as one rigid unit', () => {
    useEditor.setState({ selectedPanels: ['front', 'left'] })
    useEditor.getState().applyBoolean('union')
    const before = useEditor.getState()
    const frontBefore = before.panels.find((panel) => panel.id === 'front')!
    const leftBefore = before.panels.find((panel) => panel.id === 'left')!
    const relativeBefore = leftBefore.position.map(
      (value, axis) => value - frontBefore.position[axis],
    )
    useEditor.getState().movePanel('front', [20, 30, 40])
    const after = useEditor.getState()
    const frontAfter = after.panels.find((panel) => panel.id === 'front')!
    const leftAfter = after.panels.find((panel) => panel.id === 'left')!
    expect(frontAfter.position).toEqual([20, 30, 40])
    expect(
      leftAfter.position.map(
        (value, axis) => value - frontAfter.position[axis],
      ),
    ).toEqual(relativeBefore)
  })

  it('records a complete gizmo drag as one undoable and redoable step', () => {
    const original = useEditor
      .getState()
      .panels.find((panel) => panel.id === 'front')!.position
    useEditor.getState().beginTransform()
    useEditor.getState().movePanel('front', [10, 20, 30])
    useEditor.getState().movePanel('front', [20, 30, 40])
    useEditor.getState().endTransform()
    useEditor.getState().undo()
    expect(
      useEditor.getState().panels.find((panel) => panel.id === 'front')!
        .position,
    ).toEqual(original)
    useEditor.getState().redo()
    expect(
      useEditor.getState().panels.find((panel) => panel.id === 'front')!
        .position,
    ).toEqual([20, 30, 40])
  })

  it('serializes and restores the complete project including undo history', () => {
    const original = useEditor
      .getState()
      .panels.find((panel) => panel.id === 'front')!.position
    useEditor.getState().movePanel('front', [10, 20, 30])
    const projectFile = useEditor.getState().serializeProject()
    useEditor.getState().movePanel('front', [90, 90, 90])
    expect(useEditor.getState().loadProject(projectFile)).toBe(true)
    expect(
      useEditor.getState().panels.find((panel) => panel.id === 'front')!
        .position,
    ).toEqual([10, 20, 30])
    useEditor.getState().undo()
    expect(
      useEditor.getState().panels.find((panel) => panel.id === 'front')!
        .position,
    ).toEqual(original)
  })

  it('rejects invalid project files without replacing the model', () => {
    const panels = useEditor.getState().panels
    expect(useEditor.getState().loadProject('{"wrong":true}')).toBe(false)
    expect(useEditor.getState().panels).toBe(panels)
  })

  it('round-trips laser machines, material presets and export layers through a project file', () => {
    useEditor.getState().addLaserCutter({
      name: 'Werkstatt CO₂',
      powerWatts: 80,
      speedUnit: 'mm/s',
      notes: 'Großer Laser',
    })
    const laserId = useEditor.getState().activeLaserId
    const preset = useEditor
      .getState()
      .laserPresets.find(
        (candidate) =>
          candidate.laserId === laserId &&
          candidate.materialId === 'birch-5' &&
          candidate.operation === 'cut-outer',
      )!
    useEditor.getState().updateLaserPreset(preset.id, {
      speed: 27.5,
      power: 73,
      passes: 2,
      airAssist: true,
    })
    const outerLayer = useEditor
      .getState()
      .exportLayers.find(
        (layer) =>
          layer.materialId === 'birch-5' && layer.operation === 'cut-outer',
      )!
    useEditor.getState().updateExportLayer(outerLayer.id, {
      color: '#123456',
      name: '5 mm Außen final',
    })
    const projectFile = useEditor.getState().serializeProject()

    useEditor.getState().updateLaserCutter(laserId, { name: 'Verändert' })
    useEditor.getState().updateLaserPreset(preset.id, { speed: 999 })
    expect(useEditor.getState().loadProject(projectFile)).toBe(true)

    const state = useEditor.getState()
    expect(state.activeLaserId).toBe(laserId)
    expect(
      state.laserCutters.find((laser) => laser.id === laserId),
    ).toMatchObject({
      name: 'Werkstatt CO₂',
      powerWatts: 80,
      speedUnit: 'mm/s',
      notes: 'Großer Laser',
    })
    expect(
      state.laserPresets.find((candidate) => candidate.id === preset.id),
    ).toMatchObject({ speed: 27.5, power: 73, passes: 2, airAssist: true })
    expect(
      state.exportLayers.find((layer) => layer.id === outerLayer.id),
    ).toMatchObject({ color: '#123456', name: '5 mm Außen final' })
  })

  it('creates paired opposite cuts for a Steckkreuz', () => {
    useEditor.getState().addPanel()
    const first = useEditor.getState().panels.at(-1)!
    useEditor.getState().addPanel()
    const second = useEditor.getState().panels.at(-1)!
    useEditor.getState().rotatePanel(second.id, [0, Math.PI / 2, 0])
    useEditor.setState({ selectedPanels: [first.id, second.id] })
    useEditor
      .getState()
      .createCrossJoint({ ratio: 0.5, fit: 'tight', clearance: 0 })
    const state = useEditor.getState()
    const firstAfter = state.panels.find((panel) => panel.id === first.id)!
    const secondAfter = state.panels.find((panel) => panel.id === second.id)!
    expect(firstAfter.cuts[0].jointId).toBe(secondAfter.cuts[0].jointId)
    expect(firstAfter.cuts[0].center[1]).toBeGreaterThan(0)
    expect(secondAfter.cuts[0].center[1]).toBeLessThan(0)
    expect(state.crossJoints).toHaveLength(1)
  })

  it('stores and rebuilds the selected Steckkreuz opening direction', () => {
    useEditor.getState().addPanel()
    const first = useEditor.getState().panels.at(-1)!
    useEditor.getState().addPanel()
    const second = useEditor.getState().panels.at(-1)!
    useEditor.getState().movePanel(second.id, [40, 0, 0])
    useEditor.getState().rotatePanel(second.id, [0, Math.PI / 2, 0])
    useEditor.setState({ selectedPanels: [first.id, second.id] })
    useEditor.getState().createCrossJoint({
      ratio: 0.5,
      fit: 'tight',
      clearance: 0,
      firstFromHigh: false,
    })

    const state = useEditor.getState()
    expect(state.crossJoints[0].firstFromHigh).toBe(false)
    expect(
      state.panels.find((panel) => panel.id === first.id)!.jointFeatures[0]
        .center[1],
    ).toBeGreaterThan(0)
  })

  it('edits cuts parametrically and removes both halves of a linked joint', () => {
    useEditor.getState().addPanel()
    const first = useEditor.getState().panels.at(-1)!
    useEditor.getState().addPanel()
    const second = useEditor.getState().panels.at(-1)!
    useEditor.getState().rotatePanel(second.id, [0, Math.PI / 2, 0])
    useEditor.setState({ selectedPanels: [first.id, second.id] })
    useEditor
      .getState()
      .createCrossJoint({ ratio: 0.5, fit: 'tight', clearance: 0 })
    const cut = useEditor
      .getState()
      .panels.find((panel) => panel.id === first.id)!.cuts[0]
    useEditor.getState().updateCut(first.id, cut.id, 'size', 1, 42)
    expect(
      useEditor.getState().panels.find((panel) => panel.id === first.id)!
        .cuts[0].size[1],
    ).toBe(42)
    useEditor.getState().removeCut(first.id, cut.id)
    expect(
      useEditor.getState().panels.find((panel) => panel.id === first.id)!.cuts,
    ).toHaveLength(0)
    expect(
      useEditor.getState().panels.find((panel) => panel.id === second.id)!.cuts,
    ).toHaveLength(0)
  })

  it('creates and removes both sides of a finger joint as one coupled operation', () => {
    const before = Object.fromEntries(
      useEditor
        .getState()
        .panels.filter((panel) => panel.id === 'front' || panel.id === 'left')
        .map((panel) => [
          panel.id,
          {
            position: panel.position,
            rotation: panel.rotation,
            size: panel.size,
          },
        ]),
    )
    useEditor.setState({ selectedPanels: ['front', 'left'] })
    useEditor.getState().createFingerJoint({
      connectionType: 'finger',
      fingerWidth: 12,
      fit: 'press',
      clearance: 0,
      style: 'straight',
      reliefDiameter: 1,
    })
    const state = useEditor.getState()
    expect(state.fingerJoints).toHaveLength(1)
    expect(
      state.panels.find((panel) => panel.id === 'front')!.jointFeatures.length,
    ).toBeGreaterThan(0)
    expect(
      state.panels.find((panel) => panel.id === 'left')!.jointFeatures.length,
    ).toBeGreaterThan(0)
    for (const panelId of ['front', 'left']) {
      const panel = state.panels.find((candidate) => candidate.id === panelId)!
      expect({
        position: panel.position,
        rotation: panel.rotation,
        size: panel.size,
      }).toEqual(before[panelId])
    }
    useEditor.getState().removeFingerJoint(state.fingerJoints[0].id)
    expect(useEditor.getState().fingerJoints).toHaveLength(0)
    expect(
      useEditor.getState().panels.find((panel) => panel.id === 'front')!
        .jointFeatures,
    ).toHaveLength(0)
    expect(
      useEditor.getState().panels.find((panel) => panel.id === 'left')!
        .jointFeatures,
    ).toHaveLength(0)
  })

  it('removes only finger joints fully contained in a multiple selection', () => {
    useEditor.setState({ selectedPanels: ['front', 'left'] })
    useEditor.getState().createFingerJoint({
      connectionType: 'finger',
      fingerWidth: 12,
      fit: 'tight',
      clearance: 0,
      style: 'straight',
      reliefDiameter: 1,
    })
    useEditor.setState({ selectedPanels: ['front', 'right'] })
    useEditor.getState().createFingerJoint({
      connectionType: 'finger',
      fingerWidth: 12,
      fit: 'tight',
      clearance: 0,
      style: 'straight',
      reliefDiameter: 1,
    })
    expect(useEditor.getState().fingerJoints).toHaveLength(2)
    useEditor.setState({ selectedPanels: ['front', 'left'] })
    useEditor.getState().removeFingerJointsFromSelection()
    expect(useEditor.getState().fingerJoints).toHaveLength(1)
    expect(useEditor.getState().fingerJoints[0].secondPanelId).toBe('right')
    expect(
      useEditor.getState().panels.find((panel) => panel.id === 'left')!
        .jointFeatures,
    ).toHaveLength(0)
    expect(
      useEditor.getState().panels.find((panel) => panel.id === 'right')!
        .jointFeatures.length,
    ).toBeGreaterThan(0)
  })

  it('assigns reusable machining profiles and can exclude an object from automatic cutting', () => {
    const panel = useEditor.getState().panels[0]
    const profile = useEditor.getState().processingProfiles[0]
    useEditor.getState().addProcessingAssignment(panel.id, profile.id)
    useEditor.getState().setPanelAutoCut(panel.id, false)
    const updated = useEditor
      .getState()
      .panels.find((candidate) => candidate.id === panel.id)!
    expect(updated.autoCut).toBe(false)
    expect(updated.processingAssignments).toEqual([
      expect.objectContaining({
        profileId: profile.id,
        geometry: profile.geometry,
      }),
    ])
    useEditor
      .getState()
      .removeProcessingAssignment(
        panel.id,
        updated.processingAssignments![0].id,
      )
    expect(
      useEditor
        .getState()
        .panels.find((candidate) => candidate.id === panel.id)!
        .processingAssignments,
    ).toEqual([])
  })

  it('creates text as engraving without an automatic cut', () => {
    useEditor.getState().addShape('text')
    const text = useEditor.getState().panels.at(-1)!
    expect(text.autoCut).toBe(false)
    expect(text.processingAssignments).toHaveLength(1)
    const profile = useEditor
      .getState()
      .processingProfiles.find(
        (candidate) =>
          candidate.id === text.processingAssignments![0].profileId,
      )
    expect(profile).toMatchObject({ geometry: 'fill' })
  })

  it('keeps object profile assignments when switching to a newly added laser', () => {
    const panel = useEditor.getState().panels[0]
    const profile = useEditor.getState().processingProfiles[0]
    useEditor.getState().addProcessingAssignment(panel.id, profile.id)
    useEditor.getState().addLaserCutter({
      name: 'Neuer Laser',
      powerWatts: 20,
      speedUnit: 'mm/s',
      notes: '',
    })
    const state = useEditor.getState()
    expect(
      state.panels.find((candidate) => candidate.id === panel.id)
        ?.processingAssignments,
    ).toEqual([expect.objectContaining({ profileId: profile.id })])
    expect(state.processingProfiles).toHaveLength(3)
    expect(
      state.processingRecipes.some(
        (recipe) =>
          recipe.laserId === state.activeLaserId &&
          recipe.profileId === profile.id,
      ),
    ).toBe(false)
  })
})
