import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Euler,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Matrix4,
  Quaternion,
  Shape,
  Vector3,
} from 'three'
import {
  ADDITION,
  Brush,
  DIFFERENCE,
  Evaluator,
  INTERSECTION,
  REVERSE_SUBTRACTION,
  SUBTRACTION,
} from 'three-bvh-csg'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import {
  thinAxis,
  type BooleanOperation,
  type JointFeature,
  type PanelDefinition,
} from './box'
import { contourShapes, textOutlineShapes } from './contours'

function mapContourGeometryToPanel(
  geometry: BufferGeometry,
  panel: PanelDefinition,
) {
  const thin = thinAxis(panel)
  const axes = ([0, 1, 2] as const).filter((axis) => axis !== thin)
  const value = (localAxis: number, contourAxis: number) =>
    axes[contourAxis] === localAxis ? 1 : 0
  geometry.applyMatrix4(
    new Matrix4().set(
      value(0, 0),
      value(0, 1),
      thin === 0 ? 1 : 0,
      0,
      value(1, 0),
      value(1, 1),
      thin === 1 ? 1 : 0,
      0,
      value(2, 0),
      value(2, 1),
      thin === 2 ? 1 : 0,
      0,
      0,
      0,
      0,
      1,
    ),
  )
  return geometry
}

function baseGeometry(panel: PanelDefinition): BufferGeometry {
  const panelShape = panel.shape ?? { type: 'rectangle' as const }
  if (panelShape.type !== 'free' && panelShape.editedFaces?.length) {
    const thickness = panel.size[thinAxis(panel)]
    const geometry = new ExtrudeGeometry(
      contourShapes(panelShape.editedFaces),
      {
        depth: thickness,
        bevelEnabled: false,
        steps: 1,
      },
    )
    geometry.translate(0, 0, -thickness / 2)
    return mapContourGeometryToPanel(geometry, panel)
  }
  if (panelShape.type === 'rectangle') return new BoxGeometry(...panel.size)
  if (panelShape.type === 'free') {
    const thickness = panel.size[thinAxis(panel)]
    const geometry = new ExtrudeGeometry(contourShapes(panelShape.faces), {
      depth: thickness,
      bevelEnabled: false,
      steps: 1,
    })
    geometry.translate(0, 0, -thickness / 2)
    return mapContourGeometryToPanel(geometry, panel)
  }
  if (panelShape.type === 'text') {
    if (panelShape.editedFaces?.length) {
      const geometry = new ExtrudeGeometry(
        contourShapes(panelShape.editedFaces),
        {
          depth: panel.size[2],
          bevelEnabled: false,
          steps: 1,
        },
      )
      geometry.translate(0, 0, -panel.size[2] / 2)
      return geometry
    }
    if (!panelShape.outline?.commands.length)
      return new BoxGeometry(0.1, 0.1, panel.size[2])
    const geometry = new ExtrudeGeometry(
      textOutlineShapes(panelShape.outline),
      { depth: panel.size[2], bevelEnabled: false, steps: 1, curveSegments: 6 },
    )
    geometry.translate(0, 0, -panel.size[2] / 2)
    return geometry
  }
  const width = panel.size[0],
    height = panel.size[1],
    thickness = panel.size[2]
  const outline = new Shape()
  let points: [number, number][]
  if (panelShape.type === 'triangle')
    points = [
      [0, height / 2],
      [-width / 2, -height / 2],
      [width / 2, -height / 2],
    ]
  else if (panelShape.type === 'star')
    points = Array.from({ length: panelShape.points * 2 }, (_, index) => {
      const radius =
        index % 2
          ? (Math.min(width, height) / 2) * panelShape.innerRatio
          : Math.min(width, height) / 2
      const angle = Math.PI / 2 + (index * Math.PI) / panelShape.points
      return [Math.cos(angle) * radius, Math.sin(angle) * radius] as [
        number,
        number,
      ]
    })
  else {
    const count =
      panelShape.type === 'circle' ? panelShape.segments : panelShape.sides
    points = Array.from({ length: count }, (_, index) => {
      const angle = Math.PI / 2 + (index * Math.PI * 2) / count
      return [
        (Math.cos(angle) * width) / 2,
        (Math.sin(angle) * height) / 2,
      ] as [number, number]
    })
  }
  outline.moveTo(...points[0])
  points.slice(1).forEach((point) => outline.lineTo(...point))
  outline.closePath()
  const geometry = new ExtrudeGeometry(outline, {
    depth: thickness,
    bevelEnabled: false,
    steps: 1,
  })
  geometry.translate(0, 0, -thickness / 2)
  return geometry
}

function featureGeometry(feature: JointFeature) {
  const geometry =
    feature.shape === 'box'
      ? new BoxGeometry(...feature.size)
      : new CylinderGeometry(
          Math.max(
            0.05,
            feature.size.find((_, axis) => axis !== feature.axis)! / 2,
          ),
          Math.max(
            0.05,
            feature.size.find((_, axis) => axis !== feature.axis)! / 2,
          ),
          feature.size[feature.axis ?? 1],
          16,
        )
  if (feature.shape === 'cylinder' && feature.axis === 0)
    geometry.rotateZ(Math.PI / 2)
  if (feature.shape === 'cylinder' && feature.axis === 2)
    geometry.rotateX(Math.PI / 2)
  geometry.translate(...feature.center)
  return geometry
}

function importedOperationGeometry(
  panel: PanelDefinition,
  operation: NonNullable<PanelDefinition['importedOperations']>[number],
) {
  const thickness = panel.size[thinAxis(panel)]
  const cutsThrough = operation.operation.toLowerCase() === 'cut'
  const depth = cutsThrough
    ? thickness + 0.2
    : Math.min(0.3, Math.max(0.05, thickness * 0.15))
  const geometry = new ExtrudeGeometry(contourShapes(operation.faces), {
    depth,
    bevelEnabled: false,
    steps: 1,
  })
  geometry.translate(
    0,
    0,
    cutsThrough ? -thickness / 2 - 0.1 : thickness / 2 - depth,
  )
  return mapContourGeometryToPanel(geometry, panel)
}

function evaluateBatch(
  evaluator: Evaluator,
  current: Brush,
  geometries: BufferGeometry[],
  operation: typeof ADDITION | typeof SUBTRACTION,
) {
  if (!geometries.length) return current
  const merged = mergeGeometries(geometries, false)
  geometries.forEach((geometry) => geometry.dispose())
  if (!merged) return current
  const brush = new Brush(merged)
  brush.updateMatrixWorld()
  const next = evaluator.evaluate(current, brush, operation) as Brush
  current.geometry.dispose()
  merged.dispose()
  return next
}

export function createPanelGeometry(panel: PanelDefinition) {
  const evaluator = new Evaluator()
  evaluator.useGroups = false
  evaluator.attributes = ['position', 'normal']

  let result = new Brush(baseGeometry(panel))
  result.updateMatrixWorld()

  const additions = panel.jointFeatures
    .filter((feature) => feature.operation === 'add' && feature.shape === 'box')
    .map(featureGeometry)
  const boxSubtractions = [
    ...panel.cuts.map((cut) => ({
      id: cut.id,
      jointId: cut.jointId ?? cut.id,
      operation: 'subtract' as const,
      shape: 'box' as const,
      center: cut.center,
      size: cut.socketPatternId
        ? (cut.size.map((value, axis) =>
            axis === thinAxis(panel) ? panel.size[axis] + 0.2 : value,
          ) as [number, number, number])
        : cut.size,
    })),
    ...panel.jointFeatures.filter(
      (feature) => feature.operation === 'subtract' && feature.shape === 'box',
    ),
  ].map(featureGeometry)
  const reliefSubtractions = panel.jointFeatures
    .filter(
      (feature) =>
        feature.operation === 'subtract' && feature.shape === 'cylinder',
    )
    .map(featureGeometry)
  const importedSubtractions = (panel.importedOperations ?? [])
    .filter((operation) => operation.operation.toLowerCase() === 'cut')
    .map((operation) => importedOperationGeometry(panel, operation))
  result = evaluateBatch(evaluator, result, additions, ADDITION)
  result = evaluateBatch(evaluator, result, boxSubtractions, SUBTRACTION)
  result = evaluateBatch(evaluator, result, reliefSubtractions, SUBTRACTION)
  result = evaluateBatch(evaluator, result, importedSubtractions, SUBTRACTION)

  result.geometry.computeVertexNormals()
  return result.geometry
}

type Rect2 = { minA: number; maxA: number; minB: number; maxB: number }

function featureRect(
  panel: PanelDefinition,
  center: [number, number, number],
  size: [number, number, number],
): Rect2 {
  const thin = thinAxis(panel)
  const [axisA, axisB] = ([0, 1, 2] as const).filter((axis) => axis !== thin)
  return {
    minA: center[axisA] - size[axisA] / 2,
    maxA: center[axisA] + size[axisA] / 2,
    minB: center[axisB] - size[axisB] / 2,
    maxB: center[axisB] + size[axisB] / 2,
  }
}

const contains2 = (rect: Rect2, a: number, b: number) =>
  a > rect.minA - 1e-7 &&
  a < rect.maxA + 1e-7 &&
  b > rect.minB - 1e-7 &&
  b < rect.maxB + 1e-7

/** Fast exact editor mesh for the overwhelmingly common laser-cut case:
 * a rectangular plate with axis-aligned rectangular tabs and slots. */
function createRectilinearPanelGeometry(
  panel: PanelDefinition,
): BufferGeometry | null {
  if (panel.shape && panel.shape.type !== 'rectangle') return null
  // An edited rectangle is defined by its live contour, not by panel.size.
  // Falling back to the contour extrusion makes face/edge drags alter the
  // actual visible solid on every pointer movement.
  if (panel.shape?.type === 'rectangle' && panel.shape.editedFaces?.length)
    return null
  if (panel.booleanModifiers.some((modifier) => modifier.enabled)) return null
  if (
    panel.jointFeatures.some(
      (feature) =>
        feature.shape !== 'box' &&
        !(feature.shape === 'cylinder' && feature.operation === 'subtract'),
    )
  )
    return null
  const thin = thinAxis(panel)
  const [axisA, axisB] = ([0, 1, 2] as const).filter((axis) => axis !== thin)
  const base: Rect2 = {
    minA: -panel.size[axisA] / 2,
    maxA: panel.size[axisA] / 2,
    minB: -panel.size[axisB] / 2,
    maxB: panel.size[axisB] / 2,
  }
  const additions = panel.jointFeatures
    .filter((feature) => feature.operation === 'add' && feature.shape === 'box')
    .map((feature) => featureRect(panel, feature.center, feature.size))
  const subtractions = [
    ...panel.cuts.map((cut) => featureRect(panel, cut.center, cut.size)),
    ...panel.jointFeatures
      .filter(
        (feature) =>
          feature.operation === 'subtract' && feature.shape === 'box',
      )
      .map((feature) => featureRect(panel, feature.center, feature.size)),
  ]
  if (!additions.length && !subtractions.length)
    return new BoxGeometry(...panel.size)
  const solids = [base, ...additions]
  const boundsA = [
    ...new Set(
      [...solids, ...subtractions].flatMap((rect) => [rect.minA, rect.maxA]),
    ),
  ].sort((a, b) => a - b)
  const boundsB = [
    ...new Set(
      [...solids, ...subtractions].flatMap((rect) => [rect.minB, rect.maxB]),
    ),
  ].sort((a, b) => a - b)
  const cells: BufferGeometry[] = []
  for (let aIndex = 0; aIndex < boundsA.length - 1; aIndex++)
    for (let bIndex = 0; bIndex < boundsB.length - 1; bIndex++) {
      const minA = boundsA[aIndex],
        maxA = boundsA[aIndex + 1],
        minB = boundsB[bIndex],
        maxB = boundsB[bIndex + 1]
      if (maxA - minA < 1e-7 || maxB - minB < 1e-7) continue
      const centerA = (minA + maxA) / 2,
        centerB = (minB + maxB) / 2
      if (
        !solids.some((rect) => contains2(rect, centerA, centerB)) ||
        subtractions.some((rect) => contains2(rect, centerA, centerB))
      )
        continue
      const size: [number, number, number] = [1, 1, 1]
      const center: [number, number, number] = [0, 0, 0]
      size[thin] = panel.size[thin]
      size[axisA] = maxA - minA
      size[axisB] = maxB - minB
      center[axisA] = centerA
      center[axisB] = centerB
      cells.push(new BoxGeometry(...size).translate(...center))
    }
  const merged = cells.length
    ? mergeGeometries(cells, false)
    : new BufferGeometry()
  cells.forEach((geometry) => geometry.dispose())
  return merged ?? null
}

export function createEditorPanelGeometry(
  panel: PanelDefinition,
  panels: PanelDefinition[],
) {
  return (
    createRectilinearPanelGeometry(panel) ??
    createEvaluatedPanelGeometry(panel, panels)
  )
}

const operationConstant = (operation: BooleanOperation) =>
  ({
    union: ADDITION,
    subtract: SUBTRACTION,
    intersect: INTERSECTION,
    xor: DIFFERENCE,
    'reverse-subtract': REVERSE_SUBTRACTION,
  })[operation]

function objectMatrix(panel: PanelDefinition) {
  return new Matrix4().compose(
    new Vector3(...panel.position),
    new Quaternion().setFromEuler(new Euler(...panel.rotation)),
    new Vector3(1, 1, 1),
  )
}

const roundedMatrix = (matrix: Matrix4) =>
  matrix.elements.map((value) => Math.round(value * 100000) / 100000)
const booleanCacheRoot = 'lasercut-studio:boolean-geometry:'
const booleanCachePrefix = `${booleanCacheRoot}v3:`
type CachedGeometry = {
  key: string
  position: number[]
  index: number[] | null
}
const compactGeometryKey = (value: string) => {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++)
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619)
  return (hash >>> 0).toString(36)
}

export function pruneBooleanGeometryCache(panelIds: string[]) {
  if (typeof localStorage === 'undefined') return
  const retained = new Set(panelIds.map((id) => `${booleanCachePrefix}${id}`))
  try {
    const obsolete: string[] = []
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index)
      if (key?.startsWith(booleanCacheRoot) && !retained.has(key))
        obsolete.push(key)
    }
    obsolete.forEach((key) => localStorage.removeItem(key))
  } catch {
    // Storage cleanup is best-effort only.
  }
}

function cachedBooleanGeometry(panelId: string, key: string) {
  if (typeof localStorage === 'undefined') return null
  try {
    const cached = JSON.parse(
      localStorage.getItem(`${booleanCachePrefix}${panelId}`) ?? 'null',
    ) as CachedGeometry | null
    if (!cached || cached.key !== key || !cached.position.length) return null
    const geometry = new BufferGeometry()
    geometry.setAttribute(
      'position',
      new Float32BufferAttribute(cached.position, 3),
    )
    if (cached.index) geometry.setIndex(cached.index)
    geometry.computeVertexNormals()
    return geometry
  } catch {
    return null
  }
}

function cacheBooleanGeometry(
  panelId: string,
  key: string,
  geometry: BufferGeometry,
) {
  if (typeof localStorage === 'undefined') return
  try {
    const position = Array.from(
      geometry.getAttribute('position').array as ArrayLike<number>,
    )
    const index = geometry.getIndex()
    const cached: CachedGeometry = {
      key,
      position,
      index: index ? Array.from(index.array as ArrayLike<number>) : null,
    }
    localStorage.setItem(
      `${booleanCachePrefix}${panelId}`,
      JSON.stringify(cached),
    )
  } catch {
    // The editor remains functional if the browser quota is too small.
  }
}

export function panelGeometryKey(
  panel: PanelDefinition,
  panels: PanelDefinition[],
  visited = new Set<string>(),
): string {
  if (visited.has(panel.id)) return `cycle:${panel.id}`
  const nextVisited = new Set(visited).add(panel.id)
  const local = JSON.stringify([
    panel.size,
    panel.shape,
    panel.cuts,
    panel.jointFeatures,
    panel.importedOperations?.filter(
      (operation) => operation.operation.toLowerCase() === 'cut',
    ),
  ])
  const targetInverse = objectMatrix(panel).invert()
  const modifiers = panel.booleanModifiers
    .filter((modifier) => modifier.enabled)
    .map((modifier) => {
      const tool = panels.find((candidate) => candidate.id === modifier.toolId)
      if (!tool) return [modifier.operation, modifier.toolId, 'missing']
      const relative = targetInverse.clone().multiply(objectMatrix(tool))
      return [
        modifier.operation,
        modifier.toolId,
        roundedMatrix(relative),
        panelGeometryKey(tool, panels, nextVisited),
      ]
    })
  return `${panel.id}:${local}:${JSON.stringify(modifiers)}`
}

const evaluatedGeometryCache = new Map<string, BufferGeometry>()
const evaluatedGeometryCacheLimit = 96

function cacheEvaluatedGeometry(key: string, geometry: BufferGeometry) {
  if (evaluatedGeometryCache.has(key)) return
  evaluatedGeometryCache.set(key, geometry.clone())
  while (evaluatedGeometryCache.size > evaluatedGeometryCacheLimit) {
    const oldest = evaluatedGeometryCache.keys().next().value as
      string | undefined
    if (!oldest) break
    evaluatedGeometryCache.get(oldest)?.dispose()
    evaluatedGeometryCache.delete(oldest)
  }
}

/**
 * Returns an independently disposable geometry while retaining one cached
 * copy. Selection/group changes remount meshes, but must not repeat the CSG
 * work when their actual geometry did not change.
 */
export function createCachedEvaluatedPanelGeometry(
  panel: PanelDefinition,
  panels: PanelDefinition[],
) {
  const key = panelGeometryKey(panel, panels)
  const cached = evaluatedGeometryCache.get(key)
  if (cached) {
    // Refresh insertion order so actively used geometries survive eviction.
    evaluatedGeometryCache.delete(key)
    evaluatedGeometryCache.set(key, cached)
    return cached.clone()
  }
  const geometry = createEditorPanelGeometry(panel, panels)
  cacheEvaluatedGeometry(key, geometry)
  return geometry
}

export function clearEvaluatedGeometryCache() {
  evaluatedGeometryCache.forEach((geometry) => geometry.dispose())
  evaluatedGeometryCache.clear()
}

export function createEvaluatedPanelGeometry(
  panel: PanelDefinition,
  panels: PanelDefinition[],
  visited = new Set<string>(),
) {
  const isRoot = visited.size === 0
  const cacheKey =
    isRoot && panel.booleanModifiers.some((modifier) => modifier.enabled)
      ? compactGeometryKey(panelGeometryKey(panel, panels))
      : null
  const cached = cacheKey ? cachedBooleanGeometry(panel.id, cacheKey) : null
  if (cached) return cached
  if (visited.has(panel.id)) return createPanelGeometry(panel)
  const nextVisited = new Set(visited).add(panel.id)
  const evaluator = new Evaluator()
  evaluator.useGroups = false
  evaluator.attributes = ['position', 'normal']
  let result = new Brush(createPanelGeometry(panel))
  result.updateMatrixWorld()
  const targetInverse = objectMatrix(panel).invert()

  for (const modifier of panel.booleanModifiers.filter(
    (item) => item.enabled,
  )) {
    const tool = panels.find((candidate) => candidate.id === modifier.toolId)
    if (!tool || nextVisited.has(tool.id)) continue
    const relativeMatrix = targetInverse.clone().multiply(objectMatrix(tool))
    let evaluatedTool = tool
    if (modifier.operation === 'subtract' && tool.shape?.type === 'text') {
      const toolThin = thinAxis(tool)
      const size: [number, number, number] = [...tool.size]
      size[toolThin] += 0.2
      evaluatedTool = { ...tool, size }
    }
    const toolGeometry = createEvaluatedPanelGeometry(
      evaluatedTool,
      panels,
      nextVisited,
    )
    const toolBrush = new Brush(toolGeometry)
    toolBrush.matrixAutoUpdate = false
    toolBrush.matrix.copy(relativeMatrix)
    toolBrush.matrixWorld.copy(toolBrush.matrix)
    const previous = result
    result = evaluator.evaluate(
      result,
      toolBrush,
      operationConstant(modifier.operation),
    ) as Brush
    previous.geometry.dispose()
    toolGeometry.dispose()
  }

  result.geometry.computeVertexNormals()
  if (cacheKey) cacheBooleanGeometry(panel.id, cacheKey, result.geometry)
  return result.geometry
}
