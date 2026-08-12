import type { PanelDefinition } from './box'
import { worldHalfExtents } from './snapping'
import { Euler, Vector3 } from 'three'
import { evaluatedPanelLocalBounds } from './panelGeometry'

export type AlignmentGuide = {
  axis: 0 | 1 | 2
  label: string
  points: [[number, number, number], [number, number, number]]
  position: [number, number, number]
  snapped: boolean
  kind?: 'alignment' | 'distance'
}

const labels = [
  ['Linke Kante', 'Mitte X', 'Rechte Kante'],
  ['Unterkante', 'Mitte Y', 'Oberkante'],
  ['Hinterkante', 'Mitte Z', 'Vorderkante'],
]

export function boundingBoxDistance(
  a: PanelDefinition,
  aPosition: [number, number, number],
  b: PanelDefinition,
) {
  const aHalf = worldHalfExtents(a)
  const bHalf = worldHalfExtents(b)
  const gaps = [0, 1, 2].map((axis) =>
    Math.max(
      0,
      Math.abs(aPosition[axis] - b.position[axis]) - aHalf[axis] - bHalf[axis],
    ),
  )
  return Math.hypot(...gaps)
}

export function calculateAlignmentGuides(
  moving: PanelDefinition,
  position: [number, number, number],
  others: PanelDefinition[],
  guideDistance = 12,
  snapDistance = 3,
  maxObjectDistance = 80,
): AlignmentGuide[] {
  const movingHalf = worldHalfExtents(moving)
  const guides: AlignmentGuide[] = []

  for (const axis of [0, 1, 2] as const) {
    let best: {
      delta: number
      landmark: number
      other: PanelDefinition
      coordinate: number
    } | null = null
    for (const other of others) {
      if (boundingBoxDistance(moving, position, other) > maxObjectDistance)
        continue
      const otherHalf = worldHalfExtents(other)
      const movingCoordinates = [
        position[axis] - movingHalf[axis],
        position[axis],
        position[axis] + movingHalf[axis],
      ]
      const otherCoordinates = [
        other.position[axis] - otherHalf[axis],
        other.position[axis],
        other.position[axis] + otherHalf[axis],
      ]
      for (let landmark = 0; landmark < 3; landmark++) {
        const delta = Math.abs(
          movingCoordinates[landmark] - otherCoordinates[landmark],
        )
        if (delta <= guideDistance && (!best || delta < best.delta))
          best = {
            delta,
            landmark,
            other,
            coordinate: otherCoordinates[landmark],
          }
      }
    }
    if (!best) continue
    const start: [number, number, number] = [...position]
    const end: [number, number, number] = [...best.other.position]
    start[axis] = best.coordinate
    end[axis] = best.coordinate
    if (start.every((value, index) => Math.abs(value - end[index]) < 0.001)) {
      const displayAxis = axis === 0 ? 1 : 0
      start[displayAxis] -= 18
      end[displayAxis] += 18
    }
    guides.push({
      axis,
      label: labels[axis][best.landmark],
      points: [start, end],
      position: start.map((value, index) => (value + end[index]) / 2) as [
        number,
        number,
        number,
      ],
      snapped: best.delta <= snapDistance,
    })
  }
  return guides
}

export function calculateDistanceGuides(
  moving: PanelDefinition,
  position: [number, number, number],
  others: PanelDefinition[],
  activeAxes: Set<0 | 1 | 2>,
  geometryPanels: PanelDefinition[] = [moving, ...others],
): AlignmentGuide[] {
  const worldBounds = (
    panel: PanelDefinition,
    panelPosition: [number, number, number],
  ) => {
    const local = evaluatedPanelLocalBounds(panel, geometryPanels)
    const rotation = new Euler(...panel.rotation)
    const min = [Infinity, Infinity, Infinity]
    const max = [-Infinity, -Infinity, -Infinity]
    for (const x of [local.min[0], local.max[0]])
      for (const y of [local.min[1], local.max[1]])
        for (const z of [local.min[2], local.max[2]]) {
          const point = new Vector3(x, y, z)
            .applyEuler(rotation)
            .add(new Vector3(...panelPosition))
          for (const axis of [0, 1, 2] as const) {
            min[axis] = Math.min(min[axis], point.getComponent(axis))
            max[axis] = Math.max(max[axis], point.getComponent(axis))
          }
        }
    return {
      min: min as [number, number, number],
      max: max as [number, number, number],
    }
  }
  const movingBounds = worldBounds(moving, position)
  const guides: AlignmentGuide[] = []
  const projectionTolerance = 2
  for (const axis of activeAxes) {
    const perpendicular = ([0, 1, 2] as const).filter(
      (candidate) => candidate !== axis,
    )
    const movingMin = movingBounds.min[axis]
    const movingMax = movingBounds.max[axis]
    let before: {
      gap: number
      surface: number
      other: PanelDefinition
    } | null = null
    let after: { gap: number; surface: number; other: PanelDefinition } | null =
      null
    for (const other of others) {
      const otherBounds = worldBounds(other, other.position)
      const overlapsProjection = perpendicular.every((candidate) => {
        const overlap =
          Math.min(movingBounds.max[candidate], otherBounds.max[candidate]) -
          Math.max(movingBounds.min[candidate], otherBounds.min[candidate])
        return overlap >= -projectionTolerance
      })
      if (!overlapsProjection) continue
      const otherMin = otherBounds.min[axis]
      const otherMax = otherBounds.max[axis]
      if (otherMax <= movingMin + 1e-7) {
        const gap = Math.max(0, movingMin - otherMax)
        if (!before || gap < before.gap)
          before = { gap, surface: otherMax, other }
      }
      if (otherMin >= movingMax - 1e-7) {
        const gap = Math.max(0, otherMin - movingMax)
        if (!after || gap < after.gap) after = { gap, surface: otherMin, other }
      }
    }
    for (const candidate of [
      before && { ...before, movingSurface: movingMin },
      after && { ...after, movingSurface: movingMax },
    ].filter(Boolean) as {
      gap: number
      surface: number
      movingSurface: number
      other: PanelDefinition
    }[]) {
      const otherBounds = worldBounds(candidate.other, candidate.other.position)
      const start: [number, number, number] = [...position]
      const end: [number, number, number] = [...position]
      start[axis] = candidate.movingSurface
      end[axis] = candidate.surface
      for (const crossAxis of perpendicular) {
        const overlapLow = Math.max(
          movingBounds.min[crossAxis],
          otherBounds.min[crossAxis],
        )
        const overlapHigh = Math.min(
          movingBounds.max[crossAxis],
          otherBounds.max[crossAxis],
        )
        start[crossAxis] = end[crossAxis] = (overlapLow + overlapHigh) / 2
      }
      guides.push({
        axis,
        label: `${candidate.gap.toFixed(1).replace('.', ',')} mm`,
        points: [start, end],
        position: start.map((value, index) => (value + end[index]) / 2) as [
          number,
          number,
          number,
        ],
        snapped: candidate.gap < 0.001,
        kind: 'distance',
      })
    }
  }
  return guides
}
