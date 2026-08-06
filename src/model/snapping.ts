import { Euler, Matrix4, Vector3 } from 'three'
import type { CutOperation, PanelDefinition } from './box'

type WorldBounds = {
  center: [number, number, number]
  half: [number, number, number]
}

function worldCutBounds(
  panel: PanelDefinition,
  cut: CutOperation,
): WorldBounds {
  const rotation = new Matrix4().makeRotationFromEuler(
    new Euler(...panel.rotation),
  )
  const center = new Vector3(...cut.center)
    .applyMatrix4(rotation)
    .add(new Vector3(...panel.position))
  const elements = rotation.elements
  const half = cut.size.map((value) => value / 2) as [number, number, number]
  return {
    center: center.toArray() as [number, number, number],
    half: [
      Math.abs(elements[0]) * half[0] +
        Math.abs(elements[4]) * half[1] +
        Math.abs(elements[8]) * half[2],
      Math.abs(elements[1]) * half[0] +
        Math.abs(elements[5]) * half[1] +
        Math.abs(elements[9]) * half[2],
      Math.abs(elements[2]) * half[0] +
        Math.abs(elements[6]) * half[1] +
        Math.abs(elements[10]) * half[2],
    ],
  }
}

export function worldHalfExtents(
  panel: PanelDefinition,
): [number, number, number] {
  const matrix = new Matrix4().makeRotationFromEuler(
    new Euler(...panel.rotation),
  )
  const elements = matrix.elements
  const half = panel.size.map((value) => value / 2) as [number, number, number]
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
  const movingHalf = worldHalfExtents(moving)
  const best: ({ value: number; distance: number } | null)[] = [
    null,
    null,
    null,
  ]
  const hasDraggedSurfaceContact = [false, false, false]

  for (const other of others) {
    const otherHalf = worldHalfExtents(other)
    const gaps = [0, 1, 2].map((axis) =>
      Math.max(
        0,
        Math.abs(position[axis] - other.position[axis]) -
          movingHalf[axis] -
          otherHalf[axis],
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
      if (closeInProjection) {
        for (const side of [-1, 1]) {
          const candidate =
            other.position[axis] + side * (otherHalf[axis] + movingHalf[axis])
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
        for (const movingCoordinate of movingCoordinates) {
          for (const otherCoordinate of otherCoordinates) {
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

    for (const cut of other.cuts) {
      if (cut.jointId || cut.socketPatternId) continue
      const cutBounds = worldCutBounds(other, cut)
      const cutGaps = ([0, 1, 2] as const).map((axis) =>
        Math.max(
          0,
          Math.abs(position[axis] - cutBounds.center[axis]) -
            movingHalf[axis] -
            cutBounds.half[axis],
        ),
      )
      if (cutGaps.some((gap) => gap > distance)) continue
      for (const axis of [0, 1, 2] as const) {
        if (hasDraggedSurfaceContact[axis]) continue
        const movingCoordinates = [
          position[axis] - movingHalf[axis],
          position[axis],
          position[axis] + movingHalf[axis],
        ]
        const cutCoordinates = [
          cutBounds.center[axis] - cutBounds.half[axis],
          cutBounds.center[axis],
          cutBounds.center[axis] + cutBounds.half[axis],
        ]
        for (const index of [0, 1, 2] as const) {
          const delta = Math.abs(
            movingCoordinates[index] - cutCoordinates[index],
          )
          if (
            delta <= distance &&
            (!best[axis] || delta < best[axis]!.distance)
          )
            best[axis] = {
              value:
                position[axis] +
                cutCoordinates[index] -
                movingCoordinates[index],
              distance: delta,
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
