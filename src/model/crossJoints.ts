import {
  thinAxis,
  type CrossJointDefinition,
  type CutOperation,
  type FitPreset,
  type JointFeature,
  type PanelDefinition,
} from './box'
import { analyzeConnection } from './connectionAnalysis'
import { fitClearance } from './fingerJoints'
import {
  worldAxisForLocal,
  worldOffsetInLocal,
  worldThinAxis,
} from './orientation'

const id = (prefix: string) =>
  `${prefix}-${Math.random().toString(36).slice(2, 9)}`

function worldCutToLocal(
  panel: PanelDefinition,
  center: [number, number, number],
  size: [number, number, number],
  jointId: string,
): CutOperation {
  const offset: [number, number, number] = [
    center[0] - panel.position[0],
    center[1] - panel.position[1],
    center[2] - panel.position[2],
  ]
  return {
    id: id('cross-cut'),
    kind: 'half-lap',
    jointId,
    center: worldOffsetInLocal(panel, offset),
    size: [0, 1, 2].map(
      (localAxis) => size[worldAxisForLocal(panel, localAxis as 0 | 1 | 2)],
    ) as [number, number, number],
  }
}

function worldAdditionToLocal(
  panel: PanelDefinition,
  center: [number, number, number],
  size: [number, number, number],
  jointId: string,
): JointFeature {
  const offset: [number, number, number] = [
    center[0] - panel.position[0],
    center[1] - panel.position[1],
    center[2] - panel.position[2],
  ]
  return {
    id: id('cross-extension'),
    jointId,
    operation: 'add',
    shape: 'box',
    center: worldOffsetInLocal(panel, offset),
    size: [0, 1, 2].map(
      (localAxis) => size[worldAxisForLocal(panel, localAxis as 0 | 1 | 2)],
    ) as [number, number, number],
  }
}

export function buildCrossJoint(
  first: PanelDefinition,
  second: PanelDefinition,
  options: {
    ratio: number
    fit: FitPreset
    clearance: number
    firstFromHigh?: boolean
  },
  jointId = id('cross-joint'),
):
  | {
      definition: CrossJointDefinition
      firstCut: CutOperation
      secondCut: CutOperation
      firstFeatures: JointFeature[]
      secondFeatures: JointFeature[]
    }
  | { error: string } {
  const analysis = analyzeConnection(first, second)
  if (!analysis.possible.cross) return { error: analysis.message }
  const ratio = Math.min(0.9, Math.max(0.1, options.ratio))
  const clearance = fitClearance(options.fit, options.clearance)
  const shared = analysis.sharedWorldAxis
  const firstThin = worldThinAxis(first)
  const secondThin = worldThinAxis(second)
  const overlap = analysis.overlapHigh - analysis.overlapLow
  const firstDepth = overlap * ratio
  const secondDepth = overlap * (1 - ratio)
  const firstFromHigh = options.firstFromHigh !== false
  const intersection: [number, number, number] = [0, 0, 0]
  intersection[firstThin] = first.position[firstThin]
  intersection[secondThin] = second.position[secondThin]
  // The shared axis is not necessarily centred at world coordinate zero.
  // T-joints need their added overlap material at the real common span;
  // otherwise an offset assembly grows a stray bar outside both plates.
  intersection[shared] = (analysis.overlapLow + analysis.overlapHigh) / 2
  const firstCenter: [number, number, number] = [...intersection]
  const secondCenter: [number, number, number] = [...intersection]
  firstCenter[shared] = firstFromHigh
    ? analysis.overlapHigh - firstDepth / 2 + 0.5
    : analysis.overlapLow + firstDepth / 2 - 0.5
  secondCenter[shared] = firstFromHigh
    ? analysis.overlapLow + secondDepth / 2 - 0.5
    : analysis.overlapHigh - secondDepth / 2 + 0.5
  const firstSize: [number, number, number] = [1, 1, 1]
  const secondSize: [number, number, number] = [1, 1, 1]
  firstSize[firstThin] = first.size[thinAxis(first)] + 2
  firstSize[secondThin] = Math.max(
    0.2,
    second.size[thinAxis(second)] + clearance,
  )
  firstSize[shared] = firstDepth + 1
  secondSize[secondThin] = second.size[thinAxis(second)] + 2
  secondSize[firstThin] = Math.max(0.2, first.size[thinAxis(first)] + clearance)
  secondSize[shared] = secondDepth + 1
  const extensionSize: [number, number, number] = [1, 1, 1]
  extensionSize[firstThin] = first.size[thinAxis(first)]
  extensionSize[secondThin] = second.size[thinAxis(second)]
  const firstExtensionCenter: [number, number, number] = [...intersection]
  const secondExtensionCenter: [number, number, number] = [...intersection]
  // Only create the part that remains after the half-lap cut. Apart from
  // avoiding needless CSG overlap, this makes the preview visibly switch
  // between the lower and upper half when the selection order is reversed.
  const firstExtensionSize: [number, number, number] = [...extensionSize]
  firstExtensionSize[shared] = secondDepth
  firstExtensionCenter[shared] = firstFromHigh
    ? analysis.overlapLow + secondDepth / 2
    : analysis.overlapHigh - secondDepth / 2
  const secondExtensionSize: [number, number, number] = [...extensionSize]
  secondExtensionSize[shared] = firstDepth
  secondExtensionCenter[shared] = firstFromHigh
    ? analysis.overlapHigh - firstDepth / 2
    : analysis.overlapLow + firstDepth / 2
  const firstFeatures = analysis.firstAtEdge
    ? [
        worldAdditionToLocal(
          first,
          firstExtensionCenter,
          firstExtensionSize,
          jointId,
        ),
      ]
    : []
  const secondFeatures = analysis.secondAtEdge
    ? [
        worldAdditionToLocal(
          second,
          secondExtensionCenter,
          secondExtensionSize,
          jointId,
        ),
      ]
    : []
  return {
    definition: {
      id: jointId,
      firstPanelId: first.id,
      secondPanelId: second.id,
      ratio,
      fit: options.fit,
      clearance,
      firstFromHigh,
    },
    firstCut: worldCutToLocal(first, firstCenter, firstSize, jointId),
    secondCut: worldCutToLocal(second, secondCenter, secondSize, jointId),
    firstFeatures,
    secondFeatures,
  }
}
