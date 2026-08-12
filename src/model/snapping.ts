import { Euler, Matrix4, Vector3 } from 'three'
import { thinAxis, type PanelDefinition } from './box'
import { worldThinAxis } from './orientation'

function worldPanelBounds(
  panel: PanelDefinition,
  position: [number, number, number] = panel.position,
) {
  const localMin = panel.size.map((value) => -value / 2) as [
    number,
    number,
    number,
  ]
  const localMax = panel.size.map((value) => value / 2) as [
    number,
    number,
    number,
  ]
  const faces =
    panel.shape?.type === 'free' ? panel.shape.faces : panel.shape?.editedFaces
  if (faces?.length) {
    const thin = thinAxis(panel)
    const planeAxes = ([0, 1, 2] as const).filter((axis) => axis !== thin)
    const points = faces.flatMap((face) => face.outer)
    if (points.length)
      for (const coordinate of [0, 1] as const) {
        const axis = planeAxes[coordinate]
        localMin[axis] = Math.min(...points.map((point) => point[coordinate]))
        localMax[axis] = Math.max(...points.map((point) => point[coordinate]))
      }
  }
  const rotation = new Matrix4().makeRotationFromEuler(
    new Euler(...panel.rotation),
  )
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const x of [localMin[0], localMax[0]])
    for (const y of [localMin[1], localMax[1]])
      for (const z of [localMin[2], localMax[2]]) {
        const point = new Vector3(x, y, z)
          .applyMatrix4(rotation)
          .add(new Vector3(...position))
        for (const axis of [0, 1, 2] as const) {
          min[axis] = Math.min(min[axis], point.getComponent(axis))
          max[axis] = Math.max(max[axis], point.getComponent(axis))
        }
      }
  return {
    min: min as [number, number, number],
    max: max as [number, number, number],
    center: min.map((value, axis) => (value + max[axis]) / 2) as [
      number,
      number,
      number,
    ],
  }
}

type WorldBounds = ReturnType<typeof worldPanelBounds>

function clipPolygonToCoordinateRange(
  polygon: Vector3[],
  axis: 0 | 1 | 2,
  limit: number,
  keepAbove: boolean,
) {
  if (!polygon.length) return polygon
  const result: Vector3[] = []
  const inside = (point: Vector3) =>
    keepAbove
      ? point.getComponent(axis) >= limit - 1e-7
      : point.getComponent(axis) <= limit + 1e-7
  for (let index = 0; index < polygon.length; index++) {
    const start = polygon[index]
    const end = polygon[(index + 1) % polygon.length]
    const startInside = inside(start)
    const endInside = inside(end)
    if (startInside) result.push(start.clone())
    if (startInside === endInside) continue
    const startValue = start.getComponent(axis)
    const endValue = end.getComponent(axis)
    const denominator = endValue - startValue
    if (Math.abs(denominator) < 1e-12) continue
    result.push(start.clone().lerp(end, (limit - startValue) / denominator))
  }
  return result
}

/**
 * Restricts an edited contour to the part that actually overlaps the target.
 * A plain AABB can otherwise snap a protruding vertex which lies beyond the
 * target panel, leaving a visible gap throughout their shared area.
 */
function projectedContourRange(
  panel: PanelDefinition,
  position: [number, number, number],
  snapAxis: 0 | 1 | 2,
  targetBounds: WorldBounds,
) {
  const faces =
    panel.shape?.type === 'free' ? panel.shape.faces : panel.shape?.editedFaces
  if (!faces?.length) return null
  const thin = thinAxis(panel)
  const planeAxes = ([0, 1, 2] as const).filter((axis) => axis !== thin)
  const rotation = new Matrix4().makeRotationFromEuler(
    new Euler(...panel.rotation),
  )
  const origin = new Vector3(...position)
  const values: number[] = []
  for (const face of faces) {
    for (const thickness of [-panel.size[thin] / 2, panel.size[thin] / 2]) {
      let polygon = face.outer.map((point) => {
        const coordinates: [number, number, number] = [0, 0, 0]
        coordinates[thin] = thickness
        coordinates[planeAxes[0]] = point[0]
        coordinates[planeAxes[1]] = point[1]
        return new Vector3(...coordinates).applyMatrix4(rotation).add(origin)
      })
      for (const axis of [0, 1, 2] as const) {
        if (axis === snapAxis) continue
        polygon = clipPolygonToCoordinateRange(
          polygon,
          axis,
          targetBounds.min[axis],
          true,
        )
        polygon = clipPolygonToCoordinateRange(
          polygon,
          axis,
          targetBounds.max[axis],
          false,
        )
      }
      values.push(...polygon.map((point) => point.getComponent(snapAxis)))
    }
  }
  return values.length
    ? { min: Math.min(...values), max: Math.max(...values) }
    : null
}

function halfExtentsForMatrix(
  size: [number, number, number],
  matrix: Matrix4,
): [number, number, number] {
  const elements = matrix.elements
  const half = size.map((value) => value / 2) as [number, number, number]
  return [
    Math.abs(elements[0]) * half[0] +
      Math.abs(elements[4]) * half[1] +
      Math.abs(elements[8]) * half[2],
    Math.abs(elements[1]) * half[0] +
      Math.abs(elements[5]) * half[1] +
      Math.abs(elements[9]) * half[2],
    Math.abs(elements[2]) * half[0] +
      Math.abs(elements[6]) * half[1] +
      Math.abs(elements[10]) * half[2],
  ]
}

export function worldHalfExtents(
  panel: PanelDefinition,
): [number, number, number] {
  const matrix = new Matrix4().makeRotationFromEuler(
    new Euler(...panel.rotation),
  )
  return halfExtentsForMatrix(panel.size, matrix)
}

export function surfaceSnapDistance(panel: PanelDefinition) {
  const surfaceDimensions = [...panel.size].sort((a, b) => b - a)
  if (panel.shape?.type === 'free' && panel.shape.sourceType === 'svg')
    return Math.min(12, Math.max(4, surfaceDimensions[1] * 0.08))
  return Math.min(10, Math.max(0.5, surfaceDimensions[1] * 0.05))
}

export function snapPanelPosition(
  moving: PanelDefinition,
  position: [number, number, number],
  others: PanelDefinition[],
  distance = surfaceSnapDistance(moving),
): [number, number, number] {
  const movingBounds = worldPanelBounds(moving, position)
  const best: ({ value: number; distance: number } | null)[] = [
    null,
    null,
    null,
  ]
  const hasDraggedSurfaceContact = [false, false, false]
  const movingWorldThin = worldThinAxis(moving)

  for (const other of others) {
    const otherBounds = worldPanelBounds(other)
    const otherWorldThin = worldThinAxis(other)
    const gaps = [0, 1, 2].map((axis) =>
      Math.max(
        0,
        otherBounds.min[axis] - movingBounds.max[axis],
        movingBounds.min[axis] - otherBounds.max[axis],
      ),
    )
    if (Math.hypot(...gaps) > distance * Math.sqrt(3)) continue
    for (const axis of [0, 1, 2] as const) {
      const remaining = [0, 1, 2].filter((candidate) => candidate !== axis) as (
        0 | 1 | 2
      )[]
      const closeInProjection = remaining.every(
        (candidate) => gaps[candidate] <= distance,
      )
      // On the thickness axis of a wall meeting a perpendicular plate, an
      // opposite-face contact would put the wall completely outside: its
      // inner face would land on the neighbouring outer edge.  This axis must
      // use equal-sided outer-envelope alignment below instead.  On the
      // counterpart's thickness axis this remains a real edge-to-face butt
      // contact (for example a divider ending at a receiver plate).
      const alignsExteriorEnvelope =
        axis === movingWorldThin && movingWorldThin !== otherWorldThin
      if (closeInProjection && !alignsExteriorEnvelope) {
        const contactRange = projectedContourRange(
          moving,
          position,
          axis,
          otherBounds,
        )
        const movingMin = contactRange?.min ?? movingBounds.min[axis]
        const movingMax = contactRange?.max ?? movingBounds.max[axis]
        for (const side of [-1, 1]) {
          const candidate =
            side < 0
              ? position[axis] + otherBounds.min[axis] - movingMax
              : position[axis] + otherBounds.max[axis] - movingMin
          const delta = Math.abs(position[axis] - candidate)
          if (
            delta <= distance &&
            (!hasDraggedSurfaceContact[axis] ||
              !best[axis] ||
              delta < best[axis]!.distance)
          ) {
            best[axis] = { value: candidate, distance: delta }
            if (Math.abs(position[axis] - moving.position[axis]) > 1e-7)
              hasDraggedSurfaceContact[axis] = true
          }
        }
      }

      if (Math.hypot(...gaps) <= 80) {
        const coordinatePairs = [
          [movingBounds.min[axis], otherBounds.min[axis]],
          [movingBounds.center[axis], otherBounds.center[axis]],
          [movingBounds.max[axis], otherBounds.max[axis]],
        ]
        for (const [movingCoordinate, otherCoordinate] of coordinatePairs) {
          const delta = Math.abs(movingCoordinate - otherCoordinate)
          if (
            delta <= distance &&
            !hasDraggedSurfaceContact[axis] &&
            (!best[axis] || delta < best[axis]!.distance)
          ) {
            best[axis] = {
              value: position[axis] + otherCoordinate - movingCoordinate,
              distance: delta,
            }
          }
        }
      }
    }
  }
  const result: [number, number, number] = [...position]
  for (const axis of [0, 1, 2] as const)
    if (best[axis]) result[axis] = best[axis]!.value
  return new Vector3(...result).toArray() as [number, number, number]
}

type ManualCutSnapResult = {
  position: [number, number, number]
  snappedAxes: number
  axes: [boolean, boolean, boolean]
  totalDistance: number
  targetRotation: Matrix4
  targetPosition: [number, number, number]
}

function manualCutSnapResult(
  moving: PanelDefinition,
  position: [number, number, number],
  others: PanelDefinition[],
  distance = surfaceSnapDistance(moving),
): ManualCutSnapResult | null {
  const movingRotation = new Matrix4().makeRotationFromEuler(
    new Euler(...moving.rotation),
  )
  const dynamicRecesses = [
    ...moving.cuts
      .filter((cut) => Boolean(cut.jointId))
      .map((cut) => ({ center: cut.center, size: cut.size })),
    ...moving.jointFeatures
      .filter(
        (feature) =>
          feature.operation === 'subtract' && feature.shape === 'box',
      )
      .map((feature) => ({ center: feature.center, size: feature.size })),
  ]
  const movingAnchors = dynamicRecesses.length
    ? dynamicRecesses
    : [{ center: [0, 0, 0] as [number, number, number], size: moving.size }]
  const dimensionTolerance = dynamicRecesses.length
    ? Math.min(distance, 2.1)
    : 0.5
  let best: ManualCutSnapResult | null = null

  for (const other of others) {
    const targetRotation = new Matrix4().makeRotationFromEuler(
      new Euler(...other.rotation),
    )
    const targetInverse = targetRotation.clone().invert()
    const relativeRotation = targetInverse.clone().multiply(movingRotation)
    const localPosition = new Vector3(...position)
      .sub(new Vector3(...other.position))
      .applyMatrix4(targetInverse)

    for (const cut of other.cuts) {
      if (cut.jointId) continue
      const cutHalf = cut.size.map((value) => value / 2) as [
        number,
        number,
        number,
      ]
      for (const anchor of movingAnchors) {
        const anchorHalf = halfExtentsForMatrix(anchor.size, relativeRotation)
        const anchorCenter = new Vector3(...anchor.center)
          .applyMatrix4(movingRotation)
          .add(new Vector3(...position))
          .sub(new Vector3(...other.position))
          .applyMatrix4(targetInverse)
        const cutGaps = ([0, 1, 2] as const).map((axis) =>
          Math.max(
            0,
            Math.abs(anchorCenter.getComponent(axis) - cut.center[axis]) -
              anchorHalf[axis] -
              cutHalf[axis],
          ),
        )
        if (cutGaps.some((gap) => gap > distance)) continue
        const localResult = localPosition.clone()
        let snappedAxes = 0
        const axes: [boolean, boolean, boolean] = [false, false, false]
        let totalDistance = 0
        for (const axis of [0, 1, 2] as const) {
          const centerDelta = Math.abs(
            anchorCenter.getComponent(axis) - cut.center[axis],
          )
          const dimensionsMatch =
            Math.abs(anchorHalf[axis] * 2 - cut.size[axis]) <=
            dimensionTolerance
          if (dimensionsMatch && centerDelta <= distance) {
            localResult.setComponent(
              axis,
              localResult.getComponent(axis) +
                cut.center[axis] -
                anchorCenter.getComponent(axis),
            )
            snappedAxes += 1
            axes[axis] = true
            totalDistance += centerDelta
          }
        }
        if (!snappedAxes) continue
        const worldPosition = localResult
          .applyMatrix4(targetRotation)
          .add(new Vector3(...other.position))
          .toArray() as [number, number, number]
        if (
          !best ||
          snappedAxes > best.snappedAxes ||
          (snappedAxes === best.snappedAxes &&
            totalDistance < best.totalDistance)
        )
          best = {
            position: worldPosition,
            snappedAxes,
            axes,
            totalDistance,
            targetRotation,
            targetPosition: other.position,
          }
      }
    }
  }
  return best
}

export function snapPanelToManualCutPosition(
  moving: PanelDefinition,
  position: [number, number, number],
  others: PanelDefinition[],
  distance = surfaceSnapDistance(moving),
): [number, number, number] | null {
  return (
    manualCutSnapResult(moving, position, others, distance)?.position ?? null
  )
}

export function snapPanelWithManualCuts(
  moving: PanelDefinition,
  position: [number, number, number],
  others: PanelDefinition[],
  distance = surfaceSnapDistance(moving),
): [number, number, number] {
  const normal = snapPanelPosition(moving, position, others, distance)
  const manual = manualCutSnapResult(moving, position, others, distance)
  if (!manual) return normal
  const targetInverse = manual.targetRotation.clone().invert()
  const origin = new Vector3(...manual.targetPosition)
  const normalLocal = new Vector3(...normal)
    .sub(origin)
    .applyMatrix4(targetInverse)
  const manualLocal = new Vector3(...manual.position)
    .sub(origin)
    .applyMatrix4(targetInverse)
  for (const axis of [0, 1, 2] as const)
    if (manual.axes[axis])
      normalLocal.setComponent(axis, manualLocal.getComponent(axis))
  return normalLocal
    .applyMatrix4(manual.targetRotation)
    .add(origin)
    .toArray() as [number, number, number]
}

export function snapPanelCoplanarPosition(
  moving: PanelDefinition,
  position: [number, number, number],
  others: PanelDefinition[],
  distance = surfaceSnapDistance(moving),
): [number, number, number] {
  const movingHalf = worldHalfExtents(moving)
  const best: ({ value: number; distance: number } | null)[] = [
    null,
    null,
    null,
  ]
  for (const other of others) {
    const otherHalf = worldHalfExtents(other)
    for (const axis of [0, 1, 2] as const) {
      const remaining = [0, 1, 2].filter((candidate) => candidate !== axis) as (
        0 | 1 | 2
      )[]
      const nearInProjection = remaining.every(
        (candidate) =>
          Math.abs(position[candidate] - other.position[candidate]) <=
          movingHalf[candidate] + otherHalf[candidate] + 80,
      )
      if (!nearInProjection) continue
      for (const side of [-1, 1] as const) {
        const movingFace = position[axis] + side * movingHalf[axis]
        const otherFace = other.position[axis] + side * otherHalf[axis]
        const delta = Math.abs(movingFace - otherFace)
        if (delta <= distance && (!best[axis] || delta < best[axis]!.distance))
          best[axis] = {
            value: position[axis] + otherFace - movingFace,
            distance: delta,
          }
      }
    }
  }
  const result: [number, number, number] = [...position]
  for (const axis of [0, 1, 2] as const)
    if (best[axis]) result[axis] = best[axis]!.value
  return result
}
