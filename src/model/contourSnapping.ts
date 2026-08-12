import { Euler, Vector3 } from 'three'
import type { PanelDefinition } from './box'
import type { AlignmentGuide } from './alignment'
import { worldHalfExtents } from './snapping'

type Point3 = [number, number, number]

export type ContourFaceMoveResult = {
  delta: [number, number]
  guides: AlignmentGuide[]
  snapped: boolean
}

// Contour handles edit a single edge/side, so their capture range must not
// grow with the dimensions of the complete panel.
export const contourSnapDistance = 3

const tuple = (point: Vector3) => point.toArray() as Point3

/** Snap and measure an extruded contour side while it is moved in panel space. */
export function contourFaceMove(
  panel: PanelDefinition,
  edge: [[number, number], [number, number]],
  localDelta: [number, number],
  localAxis: 0 | 1,
  others: PanelDefinition[],
  snapDistance: number,
  snapping = true,
): ContourFaceMoveResult {
  const thin = panel.size.reduce(
    (best, value, axis, values) => (value < values[best] ? axis : best),
    0,
  ) as 0 | 1 | 2
  const surfaceAxes = ([0, 1, 2] as const).filter((axis) => axis !== thin)
  const rotation = new Euler(...panel.rotation)
  const direction = new Vector3()
    .setComponent(surfaceAxes[localAxis], 1)
    .applyEuler(rotation)
    .normalize()
  const displayAxis = ([0, 1, 2] as const).reduce((best, axis) =>
    Math.abs(direction.getComponent(axis)) >
    Math.abs(direction.getComponent(best))
      ? axis
      : best,
  )
  const worldPoint = (point: [number, number], thickness: number) => {
    const local = new Vector3()
    local.setComponent(surfaceAxes[0], point[0] + localDelta[0])
    local.setComponent(surfaceAxes[1], point[1] + localDelta[1])
    local.setComponent(thin, thickness)
    return local.applyEuler(rotation).add(new Vector3(...panel.position))
  }
  const movingPoints = edge.flatMap((point) => [
    worldPoint(point, -panel.size[thin] / 2),
    worldPoint(point, panel.size[thin] / 2),
  ])
  const projections = movingPoints.map((point) => point.dot(direction))
  const movingMin = Math.min(...projections)
  const movingMax = Math.max(...projections)
  const movingCenter = movingPoints
    .reduce((sum, point) => sum.add(point), new Vector3())
    .multiplyScalar(1 / movingPoints.length)
  type Candidate = {
    gap: number
    signedGap: number
    surface: number
    movingSurface: number
    targetCenter: Vector3
  }
  const candidates: Candidate[] = []
  for (const other of others) {
    if (other.hidden) continue
    const half = worldHalfExtents(other)
    const min = other.position.map(
      (value, axis) => value - half[axis],
    ) as Point3
    const max = other.position.map(
      (value, axis) => value + half[axis],
    ) as Point3
    const movingBounds = ([0, 1, 2] as const).map((axis) => ({
      min: Math.min(...movingPoints.map((point) => point.getComponent(axis))),
      max: Math.max(...movingPoints.map((point) => point.getComponent(axis))),
    }))
    const overlaps = ([0, 1, 2] as const).every(
      (axis) =>
        axis === displayAxis ||
        Math.min(movingBounds[axis].max, max[axis]) -
          Math.max(movingBounds[axis].min, min[axis]) >=
          -2,
    )
    if (!overlaps) continue

    const corners: Vector3[] = []
    for (const x of [min[0], max[0]])
      for (const y of [min[1], max[1]])
        for (const z of [min[2], max[2]]) corners.push(new Vector3(x, y, z))
    const targetProjections = corners.map((point) => point.dot(direction))
    const targetMin = Math.min(...targetProjections)
    const targetMax = Math.max(...targetProjections)
    for (const [movingSurface, surface] of [
      [movingMin, targetMax],
      [movingMax, targetMin],
    ] as const) {
      const signedGap = surface - movingSurface
      candidates.push({
        gap: Math.abs(signedGap),
        signedGap,
        surface,
        movingSurface,
        targetCenter: new Vector3(...other.position),
      })
    }
  }

  const nearest = candidates.sort((a, b) => a.gap - b.gap)[0]
  const snapCorrection =
    snapping && nearest && nearest.gap <= snapDistance ? nearest.signedGap : 0
  const corrected = [...localDelta] as [number, number]
  corrected[localAxis] += snapCorrection

  const guides: AlignmentGuide[] = []
  for (const candidate of candidates
    .filter((entry) => entry.signedGap <= 0)
    .sort((a, b) => a.gap - b.gap)
    .slice(0, 1)
    .concat(
      candidates
        .filter((entry) => entry.signedGap >= 0)
        .sort((a, b) => a.gap - b.gap)
        .slice(0, 1),
    )) {
    const correction = candidate === nearest ? snapCorrection : 0
    const start = movingCenter.clone().addScaledVector(direction, correction)
    const end = start
      .clone()
      .addScaledVector(direction, candidate.signedGap - correction)
    const gap = Math.abs(candidate.signedGap - correction)
    guides.push({
      axis: displayAxis,
      label: `${gap.toFixed(1).replace('.', ',')} mm`,
      points: [tuple(start), tuple(end)],
      position: tuple(start.clone().add(end).multiplyScalar(0.5)),
      snapped: gap < 0.001,
      kind: 'distance',
    })
  }
  return { delta: corrected, guides, snapped: snapCorrection !== 0 }
}
