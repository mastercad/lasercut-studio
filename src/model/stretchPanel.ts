import { Euler, Matrix4, Vector3 } from 'three'
import { thinAxis, type PanelDefinition } from './box'
import { worldHalfExtents } from './snapping'

type Axis = 0 | 1 | 2

function mappedWorldAxis(panel: PanelDefinition, localAxis: Axis): Axis | null {
  const rotation = new Matrix4().makeRotationFromEuler(
    new Euler(...panel.rotation),
  )
  const direction = new Vector3()
    .setComponent(localAxis, 1)
    .applyMatrix4(rotation)
  const values = [
    Math.abs(direction.x),
    Math.abs(direction.y),
    Math.abs(direction.z),
  ]
  const axis = values.indexOf(Math.max(...values)) as Axis
  return values[axis] >= 0.98 ? axis : null
}

function overlapsPanelPlane(
  target: PanelDefinition,
  other: PanelDefinition,
  normalAxis: Axis,
) {
  const targetHalf = worldHalfExtents(target)
  const otherHalf = worldHalfExtents(other)
  return (
    Math.abs(target.position[normalAxis] - other.position[normalAxis]) <=
    targetHalf[normalAxis] + otherHalf[normalAxis] + 0.1
  )
}

function boundsStretchAxis(
  target: PanelDefinition,
  other: PanelDefinition,
  stretchAxis: Axis,
  normalAxis: Axis,
) {
  if (mappedWorldAxis(other, thinAxis(other)) === stretchAxis) return true
  const crossAxis = ([0, 1, 2] as Axis[]).find(
    (axis) => axis !== stretchAxis && axis !== normalAxis,
  )!
  const targetHalf = worldHalfExtents(target)[crossAxis]
  const otherHalf = worldHalfExtents(other)[crossAxis]
  return (
    Math.abs(target.position[crossAxis] - other.position[crossAxis]) <
    targetHalf + otherHalf - 0.1
  )
}

export function stretchPanelToNearestNeighbors(
  target: PanelDefinition,
  panels: PanelDefinition[],
): { panel: PanelDefinition; stretchedAxes: number } | null {
  const result: PanelDefinition = {
    ...target,
    position: [...target.position],
    size: [...target.size],
  }
  let stretchedAxes = 0
  const normalWorldAxis = mappedWorldAxis(target, thinAxis(target))
  if (normalWorldAxis === null) return null

  for (const localAxis of ([0, 1, 2] as Axis[]).filter(
    (axis) => axis !== thinAxis(target),
  )) {
    const worldAxis = mappedWorldAxis(target, localAxis)
    if (worldAxis === null) continue
    const half = worldHalfExtents(result)[worldAxis]
    const currentMin = result.position[worldAxis] - half
    const currentMax = result.position[worldAxis] + half
    let before: number | null = null
    let after: number | null = null

    for (const other of panels) {
      if (
        other.id === target.id ||
        other.hidden ||
        !overlapsPanelPlane(result, other, normalWorldAxis) ||
        !boundsStretchAxis(result, other, worldAxis, normalWorldAxis)
      )
        continue
      const otherHalf = worldHalfExtents(other)[worldAxis]
      const otherMin = other.position[worldAxis] - otherHalf
      const otherMax = other.position[worldAxis] + otherHalf
      if (otherMax <= result.position[worldAxis] + 0.1) {
        const surface = otherMax
        if (before === null || surface > before) before = surface
      } else if (otherMin >= result.position[worldAxis] - 0.1) {
        const surface = otherMin
        if (after === null || surface < after) after = surface
      }
    }

    if (before === null && after === null) continue
    const nextMin = before ?? currentMin
    const nextMax = after ?? currentMax
    if (nextMax - nextMin < 0.5) continue
    result.position[worldAxis] = (nextMin + nextMax) / 2
    result.size[localAxis] = nextMax - nextMin
    stretchedAxes += 1
  }

  return stretchedAxes ? { panel: result, stretchedAxes } : null
}
