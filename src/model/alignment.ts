import type { PanelDefinition } from './box'
import { worldHalfExtents } from './snapping'

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
): AlignmentGuide[] {
  const movingHalf = worldHalfExtents(moving)
  const guides: AlignmentGuide[] = []
  const projectionTolerance = 2
  for (const axis of activeAxes) {
    const perpendicular = ([0, 1, 2] as const).filter(
      (candidate) => candidate !== axis,
    )
    const movingMin = position[axis] - movingHalf[axis]
    const movingMax = position[axis] + movingHalf[axis]
    let before: {
      gap: number
      surface: number
      other: PanelDefinition
    } | null = null
    let after: { gap: number; surface: number; other: PanelDefinition } | null =
      null
    for (const other of others) {
      const otherHalf = worldHalfExtents(other)
      const overlapsProjection = perpendicular.every((candidate) => {
        const overlap =
          Math.min(
            position[candidate] + movingHalf[candidate],
            other.position[candidate] + otherHalf[candidate],
          ) -
          Math.max(
            position[candidate] - movingHalf[candidate],
            other.position[candidate] - otherHalf[candidate],
          )
        return overlap >= -projectionTolerance
      })
      if (!overlapsProjection) continue
      const otherMin = other.position[axis] - otherHalf[axis]
      const otherMax = other.position[axis] + otherHalf[axis]
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
      const otherHalf = worldHalfExtents(candidate.other)
      const start: [number, number, number] = [...position]
      const end: [number, number, number] = [...position]
      start[axis] = candidate.movingSurface
      end[axis] = candidate.surface
      for (const crossAxis of perpendicular) {
        const overlapLow = Math.max(
          position[crossAxis] - movingHalf[crossAxis],
          candidate.other.position[crossAxis] - otherHalf[crossAxis],
        )
        const overlapHigh = Math.min(
          position[crossAxis] + movingHalf[crossAxis],
          candidate.other.position[crossAxis] + otherHalf[crossAxis],
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
