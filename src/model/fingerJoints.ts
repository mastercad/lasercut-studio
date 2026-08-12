import {
  thinAxis,
  type FingerJointDefinition,
  type JointFeature,
  type PanelDefinition,
} from './box'
import {
  localAxisForWorld,
  worldAxisForLocal,
  worldOffsetInLocal,
  worldThinAxis,
} from './orientation'
import { worldHalfExtents } from './snapping'

export type FingerJointOptions = Pick<
  FingerJointDefinition,
  'fingerWidth' | 'fit' | 'clearance' | 'style' | 'reliefDiameter'
>
export type FingerJointBuild = {
  definition: FingerJointDefinition
  firstFeatures: JointFeature[]
  secondFeatures: JointFeature[]
}

const featureId = (prefix: string) =>
  `${prefix}-${Math.random().toString(36).slice(2, 9)}`

function worldBoxToLocal(
  panel: PanelDefinition,
  center: [number, number, number],
  size: [number, number, number],
) {
  const offset: [number, number, number] = [
    center[0] - panel.position[0],
    center[1] - panel.position[1],
    center[2] - panel.position[2],
  ]
  const localCenter = worldOffsetInLocal(panel, offset)
  const localSize = [0, 1, 2].map(
    (localAxis) => size[worldAxisForLocal(panel, localAxis as 0 | 1 | 2)],
  ) as [number, number, number]
  return { center: localCenter, size: localSize }
}

function boxFeature(
  panel: PanelDefinition,
  jointId: string,
  operation: 'add' | 'subtract',
  center: [number, number, number],
  size: [number, number, number],
): JointFeature {
  const local = worldBoxToLocal(panel, center, size)
  return { id: featureId('finger'), jointId, operation, shape: 'box', ...local }
}

function reliefFeatures(
  panel: PanelDefinition,
  jointId: string,
  slot: JointFeature,
  sharedLocalAxis: 0 | 1 | 2,
  crossLocalAxis: 0 | 1 | 2,
  style: FingerJointOptions['style'],
  diameter: number,
  connectionType: FingerJointDefinition['connectionType'],
): JointFeature[] {
  if (style === 'straight' || diameter <= 0) return []
  const thin = thinAxis(panel)
  const radius = diameter / 2
  const sharedOffsets = [
    -slot.size[sharedLocalAxis] / 2,
    slot.size[sharedLocalAxis] / 2,
  ].filter((offset) => {
    const corner = slot.center[sharedLocalAxis] + offset
    // The first/last slot can end at the panel's outer edge. That end is
    // open, not an internal corner, and must not receive a relief hole.
    // Finger segments are shortened by 0.02 mm to avoid coincident CSG
    // faces, so retain a small geometric tolerance when detecting the edge.
    return Math.abs(corner) < panel.size[sharedLocalAxis] / 2 - 0.05
  })
  // A corner joint's slot is open at the panel edge. Only the side facing into
  // the panel has real internal corners; drilling the open side creates the
  // conspicuous round holes outside the joint. A T-joint slot is closed and
  // therefore legitimately has four internal corners.
  const innerDirection =
    slot.center[crossLocalAxis] === 0
      ? 1
      : -Math.sign(slot.center[crossLocalAxis])
  const crossOffsets =
    style !== 'dogbone'
      ? [0]
      : connectionType === 'corner'
        ? [(innerDirection * slot.size[crossLocalAxis]) / 2]
        : [-slot.size[crossLocalAxis] / 2, slot.size[crossLocalAxis] / 2]
  return sharedOffsets.flatMap((sharedOffset) =>
    crossOffsets.map((crossOffset) => {
      const center: [number, number, number] = [...slot.center]
      center[sharedLocalAxis] += sharedOffset
      center[crossLocalAxis] += crossOffset
      const size: [number, number, number] = [diameter, diameter, diameter]
      size[thin] = panel.size[thin] + 2
      return {
        id: featureId('relief'),
        jointId,
        operation: 'subtract' as const,
        shape: 'cylinder' as const,
        center,
        size,
        axis: thin,
      }
    }),
  )
}

export function fitClearance(
  preset: FingerJointOptions['fit'],
  custom: number,
) {
  if (preset === 'press') return -0.12
  if (preset === 'tight') return 0
  if (preset === 'loose') return 0.2
  return custom
}

/**
 * Fits an alternating corner-joint pattern to the complete shared edge.
 *
 * An odd segment count is essential: with the first segment assigned to the
 * first panel, it also makes the last segment a finger instead of an open
 * recess.  Pick the neighbouring odd count whose resulting width is closest
 * to the requested width, rather than blindly rounding to an even count.
 */
export function fittedCornerSegmentCount(
  overlapLength: number,
  requestedWidth: number,
) {
  if (!Number.isFinite(overlapLength) || overlapLength <= 0) return 0
  if (!Number.isFinite(requestedWidth) || requestedWidth <= 0) return 0
  const width = Math.max(2, requestedWidth)
  const idealCount = overlapLength / width
  const flooredCount = Math.floor(idealCount)
  const lowerOdd = Math.max(
    1,
    flooredCount % 2 === 0 ? flooredCount - 1 : flooredCount,
  )
  const upperOdd = lowerOdd + 2
  const lowerError = Math.abs(overlapLength / lowerOdd - width)
  const upperError = Math.abs(overlapLength / upperOdd - width)
  return upperError < lowerError ? upperOdd : lowerOdd
}

export function buildFingerJoint(
  first: PanelDefinition,
  second: PanelDefinition,
  options: FingerJointOptions,
  jointId = featureId('joint'),
): FingerJointBuild | { error: string } {
  if (!Number.isFinite(options.fingerWidth) || options.fingerWidth <= 0)
    return { error: 'Die Fingerbreite muss eine positive Zahl sein.' }
  if (!Number.isFinite(options.clearance))
    return { error: 'Das Spiel muss eine gültige Zahl sein.' }
  if (!Number.isFinite(options.reliefDiameter) || options.reliefDiameter < 0)
    return { error: 'Der Fräserdurchmesser darf nicht negativ sein.' }
  const firstWorldThin = worldThinAxis(first)
  const secondWorldThin = worldThinAxis(second)
  if (firstWorldThin === secondWorldThin)
    return { error: 'Die Platten müssen rechtwinklig zueinander stehen.' }
  const sharedWorld = ([0, 1, 2] as const).find(
    (axis) => axis !== firstWorldThin && axis !== secondWorldThin,
  )!
  const firstHalf = worldHalfExtents(first)
  const secondHalf = worldHalfExtents(second)
  const overlapLow = Math.max(
    first.position[sharedWorld] - firstHalf[sharedWorld],
    second.position[sharedWorld] - secondHalf[sharedWorld],
  )
  const overlapHigh = Math.min(
    first.position[sharedWorld] + firstHalf[sharedWorld],
    second.position[sharedWorld] + secondHalf[sharedWorld],
  )
  const overlapLength = overlapHigh - overlapLow
  if (overlapLength <= 1)
    return { error: 'Die Platten besitzen keine gemeinsame Verbindungskante.' }

  const delta: [number, number, number] = [
    second.position[0] - first.position[0],
    second.position[1] - first.position[1],
    second.position[2] - first.position[2],
  ]
  const firstCross = localAxisForWorld(first, secondWorldThin)
  const secondCross = localAxisForWorld(second, firstWorldThin)
  const firstConnection = worldOffsetInLocal(first, delta)[firstCross]
  const secondConnection = worldOffsetInLocal(second, [
    -delta[0],
    -delta[1],
    -delta[2],
  ])[secondCross]
  const firstAtEdge =
    Math.abs(Math.abs(firstConnection) - first.size[firstCross] / 2) <=
    second.size[thinAxis(second)] * 1.5 + 1
  const secondAtEdge =
    Math.abs(Math.abs(secondConnection) - second.size[secondCross] / 2) <=
    first.size[thinAxis(first)] * 1.5 + 1
  const connectionType =
    firstAtEdge && secondAtEdge
      ? 'corner'
      : firstAtEdge || secondAtEdge
        ? 't-joint'
        : null
  if (!connectionType)
    return {
      error:
        'Für eine T-Verbindung muss mindestens eine Platte mit ihrer Kante auf die andere treffen.',
    }
  if (connectionType === 't-joint' && !firstAtEdge)
    return {
      error:
        'Bei einer T-Verbindung muss die erste Auswahl die Platte mit der anstoßenden Kante sein. Bitte Auswahlreihenfolge vertauschen.',
    }

  const count =
    connectionType === 'corner'
      ? fittedCornerSegmentCount(overlapLength, options.fingerWidth)
      : Math.max(
          1,
          Math.round(
            overlapLength /
              (Number.isFinite(options.fingerWidth)
                ? Math.max(2, options.fingerWidth)
                : 2),
          ),
        )
  const segment = overlapLength / count
  const clearance = fitClearance(options.fit, options.clearance)
  const firstFeatures: JointFeature[] = []
  const secondFeatures: JointFeature[] = []
  const firstLocalShared = localAxisForWorld(first, sharedWorld)
  const secondLocalShared = localAxisForWorld(second, sharedWorld)

  for (let index = 0; index < count; index++) {
    const firstIsMale = connectionType === 't-joint' || index % 2 === 0
    if (connectionType === 't-joint' && index % 2 !== 0) continue
    const center: [number, number, number] = [0, 0, 0]
    center[firstWorldThin] = first.position[firstWorldThin]
    center[secondWorldThin] = second.position[secondWorldThin]
    center[sharedWorld] = overlapLow + segment * (index + 0.5)
    const male = firstIsMale ? first : second
    const female = firstIsMale ? second : first
    const maleThinWorld = firstIsMale ? firstWorldThin : secondWorldThin
    const femaleThinWorld = firstIsMale ? secondWorldThin : firstWorldThin
    const maleThickness = male.size[thinAxis(male)]
    const femaleThickness = female.size[thinAxis(female)]
    const tabSize: [number, number, number] = [1, 1, 1]
    tabSize[sharedWorld] = Math.max(0.2, segment - 0.02)
    tabSize[maleThinWorld] = maleThickness
    // Keep the tab exactly inside the two panels' existing outer envelope.
    // A symmetric oversize here used to protrude beyond both contact faces and
    // made a connected panel look translated. Fit belongs to the slot only.
    tabSize[femaleThinWorld] = femaleThickness
    const slotSize: [number, number, number] = [...tabSize]
    slotSize[sharedWorld] = Math.max(0.2, segment + clearance)
    slotSize[maleThinWorld] = Math.max(0.2, maleThickness + clearance)
    slotSize[femaleThinWorld] = femaleThickness + 2
    const tab = boxFeature(male, jointId, 'add', center, tabSize)
    const slot = boxFeature(female, jointId, 'subtract', center, slotSize)
    const femaleShared = firstIsMale ? secondLocalShared : firstLocalShared
    const femaleCross = firstIsMale ? secondCross : firstCross
    const relief = reliefFeatures(
      female,
      jointId,
      slot,
      femaleShared,
      femaleCross,
      options.style,
      options.reliefDiameter,
      connectionType,
    )
    if (firstIsMale) {
      firstFeatures.push(tab)
      secondFeatures.push(slot, ...relief)
    } else {
      secondFeatures.push(tab)
      firstFeatures.push(slot, ...relief)
    }
  }

  return {
    definition: {
      id: jointId,
      firstPanelId: first.id,
      secondPanelId: second.id,
      connectionType,
      ...options,
      clearance,
    },
    firstFeatures,
    secondFeatures,
  }
}
