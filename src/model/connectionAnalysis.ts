import { thinAxis, type PanelDefinition } from './box'
import {
  localAxisForWorld,
  worldOffsetInLocal,
  worldThinAxis,
} from './orientation'
import { worldHalfExtents } from './snapping'

export type ConnectionAnalysis = {
  valid: boolean
  message: string
  firstAtEdge: boolean
  secondAtEdge: boolean
  sharedWorldAxis: 0 | 1 | 2
  overlapLow: number
  overlapHigh: number
  firstCrossAxis: 0 | 1 | 2
  secondCrossAxis: 0 | 1 | 2
  firstConnection: number
  secondConnection: number
  possible: { finger: boolean; tabSlot: boolean; cross: boolean }
}

const invalid = (message: string): ConnectionAnalysis => ({
  valid: false,
  message,
  firstAtEdge: false,
  secondAtEdge: false,
  sharedWorldAxis: 1,
  overlapLow: 0,
  overlapHigh: 0,
  firstCrossAxis: 0,
  secondCrossAxis: 0,
  firstConnection: 0,
  secondConnection: 0,
  possible: { finger: false, tabSlot: false, cross: false },
})

export function analyzeConnection(
  first: PanelDefinition,
  second: PanelDefinition,
): ConnectionAnalysis {
  const firstWorldThin = worldThinAxis(first)
  const secondWorldThin = worldThinAxis(second)
  if (firstWorldThin === secondWorldThin)
    return invalid(
      'Die Platten sind parallel und bilden keine unterstützte Verbindung.',
    )
  const sharedWorldAxis = ([0, 1, 2] as const).find(
    (axis) => axis !== firstWorldThin && axis !== secondWorldThin,
  )!
  const firstHalf = worldHalfExtents(first)
  const secondHalf = worldHalfExtents(second)
  const overlapLow = Math.max(
    first.position[sharedWorldAxis] - firstHalf[sharedWorldAxis],
    second.position[sharedWorldAxis] - secondHalf[sharedWorldAxis],
  )
  const overlapHigh = Math.min(
    first.position[sharedWorldAxis] + firstHalf[sharedWorldAxis],
    second.position[sharedWorldAxis] + secondHalf[sharedWorldAxis],
  )
  if (overlapHigh - overlapLow <= 1)
    return invalid('Die Platten besitzen keine gemeinsame Verbindungslänge.')
  const delta: [number, number, number] = [
    second.position[0] - first.position[0],
    second.position[1] - first.position[1],
    second.position[2] - first.position[2],
  ]
  const firstCrossAxis = localAxisForWorld(first, secondWorldThin)
  const secondCrossAxis = localAxisForWorld(second, firstWorldThin)
  const firstConnection = worldOffsetInLocal(first, delta)[firstCrossAxis]
  const secondConnection = worldOffsetInLocal(second, [
    -delta[0],
    -delta[1],
    -delta[2],
  ])[secondCrossAxis]
  const firstTolerance = second.size[thinAxis(second)] * 1.5 + 1
  const secondTolerance = first.size[thinAxis(first)] * 1.5 + 1
  if (
    Math.abs(firstConnection) >
      first.size[firstCrossAxis] / 2 + firstTolerance ||
    Math.abs(secondConnection) >
      second.size[secondCrossAxis] / 2 + secondTolerance
  )
    return invalid('Die Platten schneiden oder berühren sich nicht.')
  const firstAtEdge =
    Math.abs(Math.abs(firstConnection) - first.size[firstCrossAxis] / 2) <=
    firstTolerance
  const secondAtEdge =
    Math.abs(Math.abs(secondConnection) - second.size[secondCrossAxis] / 2) <=
    secondTolerance
  const possible = {
    finger: firstAtEdge && secondAtEdge,
    tabSlot: firstAtEdge && !secondAtEdge,
    cross: !(firstAtEdge && secondAtEdge),
  }
  const message = possible.finger
    ? 'Zwei Kanten treffen sich.'
    : firstAtEdge !== secondAtEdge
      ? 'Eine Plattenkante trifft auf die Fläche des anderen Teils.'
      : possible.cross
        ? 'Zwei Plattenflächen kreuzen sich.'
        : 'Reihenfolge vertauschen: Die anstoßende Kante muss zuerst ausgewählt sein.'
  return {
    valid: true,
    message,
    firstAtEdge,
    secondAtEdge,
    sharedWorldAxis,
    overlapLow,
    overlapHigh,
    firstCrossAxis,
    secondCrossAxis,
    firstConnection,
    secondConnection,
    possible,
  }
}
