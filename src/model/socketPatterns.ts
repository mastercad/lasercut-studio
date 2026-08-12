import {
  thinAxis,
  type CutOperation,
  type PanelDefinition,
  type SocketInstance,
  type SocketPattern,
} from './box'

export function distributedSocketInstances(
  count: number,
  span: number,
  id: (index: number) => string,
): SocketInstance[] {
  const safeCount = Math.max(1, Math.round(count))
  const safeSpan = Math.max(0, span)
  return Array.from({ length: safeCount }, (_, index) => ({
    id: id(index),
    basePosition:
      safeCount === 1
        ? 0
        : -safeSpan / 2 + (safeSpan * index) / (safeCount - 1),
    offset: 0,
  }))
}

export type SocketPatternOptions = {
  count: number
  span: number
  slotLength: number
  targetThickness: number
  clearance: number
  distributionAxis?: 0 | 1 | 2
  socketType?: 'through' | 'cross'
  entrySide?: 'negative' | 'positive'
  depthRatio?: number
}

export function buildSocketPattern(
  panel: PanelDefinition,
  options: SocketPatternOptions,
  id: string,
  name: string,
): SocketPattern {
  const thin = thinAxis(panel)
  const planeAxes = ([0, 1, 2] as const).filter((axis) => axis !== thin)
  const distributionAxis =
    options.distributionAxis != null && options.distributionAxis !== thin
      ? options.distributionAxis
      : panel.size[planeAxes[0]] >= panel.size[planeAxes[1]]
        ? planeAxes[0]
        : planeAxes[1]
  const slotAxis = planeAxes.find((axis) => axis !== distributionAxis)!
  const slotWidth = Math.max(0.1, options.targetThickness + options.clearance)
  const maximumSpan = Math.max(0, panel.size[distributionAxis] - slotWidth)
  const span = Math.min(Math.max(0, options.span), maximumSpan)
  return {
    id,
    panelId: panel.id,
    name,
    distributionAxis,
    slotAxis,
    center: [0, 0, 0],
    span,
    slotLength: Math.min(
      Math.max(0.1, options.slotLength),
      panel.size[slotAxis],
    ),
    slotWidth,
    targetThickness: options.targetThickness,
    clearance: options.clearance,
    socketType: options.socketType ?? 'cross',
    entrySide: options.entrySide ?? 'positive',
    depthRatio: Math.min(1, Math.max(0.05, options.depthRatio ?? 0.5)),
    instances: distributedSocketInstances(
      options.count,
      span,
      (index) => `${id}-socket-${index + 1}`,
    ),
  }
}

export function socketPatternCuts(
  pattern: SocketPattern,
  panel: PanelDefinition,
): CutOperation[] {
  const thin = thinAxis(panel)
  return pattern.instances.flatMap((instance) => {
    if (instance.deleted) return []
    const center = [...pattern.center] as [number, number, number]
    center[pattern.distributionAxis] += instance.basePosition + instance.offset
    const size: [number, number, number] = [0.1, 0.1, 0.1]
    size[thin] = panel.size[thin] + 0.2
    size[pattern.distributionAxis] = pattern.slotWidth
    if (pattern.socketType === 'cross') {
      const depth = Math.max(
        0.1,
        Math.min(
          panel.size[pattern.slotAxis],
          panel.size[pattern.slotAxis] * (pattern.depthRatio ?? 0.5),
        ),
      )
      size[pattern.slotAxis] = depth + 0.1
      const direction = pattern.entrySide === 'negative' ? -1 : 1
      center[pattern.slotAxis] =
        direction * (panel.size[pattern.slotAxis] / 2 - depth / 2 + 0.05)
    } else {
      size[pattern.slotAxis] = pattern.slotLength
    }
    return [
      {
        id: `${pattern.id}:${instance.id}`,
        kind: 'hole' as const,
        center,
        size,
        socketPatternId: pattern.id,
        socketInstanceId: instance.id,
      },
    ]
  })
}

export function replaceSocketPatternCuts(
  panels: PanelDefinition[],
  pattern: SocketPattern,
) {
  return panels.map((panel) =>
    panel.id !== pattern.panelId
      ? panel
      : {
          ...panel,
          cuts: [
            ...panel.cuts.filter((cut) => cut.socketPatternId !== pattern.id),
            ...socketPatternCuts(pattern, panel),
          ],
        },
  )
}

export function buildTransferredSocketPattern(
  source: SocketPattern,
  sourcePanel: PanelDefinition,
  targetPanel: PanelDefinition,
  id: string,
  mode: 'copy' | 'mirror',
  existing?: SocketPattern,
): SocketPattern {
  const sourcePlane = ([0, 1, 2] as const).filter(
    (axis) => axis !== thinAxis(sourcePanel),
  )
  const targetPlane = ([0, 1, 2] as const).filter(
    (axis) => axis !== thinAxis(targetPanel),
  )
  const distributionAxis =
    targetPlane[Math.max(0, sourcePlane.indexOf(source.distributionAxis))]
  const slotAxis =
    targetPlane[Math.max(0, sourcePlane.indexOf(source.slotAxis))]
  const center: [number, number, number] = [0, 0, 0]
  sourcePlane.forEach((axis, index) => {
    center[targetPlane[index]] = source.center[axis]
  })
  if (mode === 'mirror') center[distributionAxis] *= -1
  return {
    ...source,
    id,
    panelId: targetPanel.id,
    name:
      existing?.name ??
      `${source.name} · ${mode === 'mirror' ? 'gespiegelt' : 'Kopie'}`,
    distributionAxis,
    slotAxis,
    center,
    sourcePatternId: source.id,
    transferMode: mode,
    instances: source.instances.map((instance, index) => ({
      ...instance,
      id: existing?.instances[index]?.id ?? `${id}-socket-${index + 1}`,
      basePosition:
        mode === 'mirror' && instance.basePosition !== 0
          ? -instance.basePosition
          : instance.basePosition,
      offset:
        mode === 'mirror' && instance.offset !== 0
          ? -instance.offset
          : instance.offset,
    })),
  }
}

export function synchronizeLinkedSocketPatterns(
  patterns: SocketPattern[],
  panels: PanelDefinition[],
  sourcePatternId: string,
) {
  let synchronized = patterns
  const pending = [sourcePatternId]
  while (pending.length) {
    const sourceId = pending.shift()!
    const source = synchronized.find((pattern) => pattern.id === sourceId)
    const sourcePanel = panels.find((panel) => panel.id === source?.panelId)
    if (!source || !sourcePanel) continue
    synchronized = synchronized.map((pattern) => {
      if (pattern.sourcePatternId !== sourceId) return pattern
      const targetPanel = panels.find((panel) => panel.id === pattern.panelId)
      if (!targetPanel) return pattern
      pending.push(pattern.id)
      return buildTransferredSocketPattern(
        source,
        sourcePanel,
        targetPanel,
        pattern.id,
        pattern.transferMode ?? 'copy',
        pattern,
      )
    })
  }
  return synchronized
}

export function replaceAllSocketPatternCuts(
  panels: PanelDefinition[],
  patterns: SocketPattern[],
) {
  return panels.map((panel) => ({
    ...panel,
    cuts: [
      ...panel.cuts.filter((cut) => !cut.socketPatternId),
      ...patterns
        .filter((pattern) => pattern.panelId === panel.id)
        .flatMap((pattern) => socketPatternCuts(pattern, panel)),
    ],
  }))
}
