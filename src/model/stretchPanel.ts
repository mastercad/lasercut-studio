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

function overlapsProjection(
  target: PanelDefinition,
  other: PanelDefinition,
  axis: Axis,
) {
  const targetHalf = worldHalfExtents(target)
  const otherHalf = worldHalfExtents(other)
  return ([0, 1, 2] as Axis[])
    .filter((candidate) => candidate !== axis)
    .every(
      (candidate) =>
        Math.abs(target.position[candidate] - other.position[candidate]) <=
        targetHalf[candidate] + otherHalf[candidate] + 0.1,
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
        !overlapsProjection(result, other, worldAxis)
      )
        continue
      const otherHalf = worldHalfExtents(other)[worldAxis]
      if (other.position[worldAxis] < result.position[worldAxis]) {
        const surface = other.position[worldAxis] + otherHalf
        if (before === null || surface > before) before = surface
      } else if (other.position[worldAxis] > result.position[worldAxis]) {
        const surface = other.position[worldAxis] - otherHalf
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
