import {
  thinAxis,
  type CrossJointDefinition,
  type MaterialDefinition,
  type PanelDefinition,
  type SocketPattern,
} from './box'

export type DesignIntegrityFinding = {
  id: string
  panelId: string
  panelLabel: string
  severity: 'error' | 'measurement'
  title: string
  detail: string
  remainingWidth?: number
  retainedRatio?: number
  cutIds: string[]
}

function separatingCutIds(panel: PanelDefinition) {
  const shape = panel.shape ?? { type: 'rectangle' as const }
  if (shape.type !== 'rectangle' || shape.editedFaces?.length) return []
  const thin = thinAxis(panel)
  const axes = ([0, 1, 2] as const).filter((axis) => axis !== thin)
  const rectangles = panel.cuts.map((cut) => ({
    id: cut.id,
    min: axes.map((axis) => cut.center[axis] - cut.size[axis] / 2),
    max: axes.map((axis) => cut.center[axis] + cut.size[axis] / 2),
  }))
  const overlaps = (
    first: (typeof rectangles)[number],
    second: (typeof rectangles)[number],
  ) =>
    first.min.every(
      (minimum, axis) =>
        minimum <= second.max[axis] + 0.001 &&
        first.max[axis] >= second.min[axis] - 0.001,
    )
  for (const crossingAxis of [0, 1] as const) {
    const low = -panel.size[axes[crossingAxis]] / 2
    const high = panel.size[axes[crossingAxis]] / 2
    const pending = rectangles.filter(
      (rectangle) => rectangle.min[crossingAxis] <= low + 0.001,
    )
    const connected = new Set(pending)
    while (pending.length) {
      const current = pending.pop()!
      for (const candidate of rectangles)
        if (!connected.has(candidate) && overlaps(current, candidate)) {
          connected.add(candidate)
          pending.push(candidate)
        }
    }
    if (
      [...connected].some(
        (rectangle) => rectangle.max[crossingAxis] >= high - 0.001,
      )
    )
      return [...connected].map((rectangle) => rectangle.id)
  }
  return []
}

export function analyzePanelIntegrity(
  panel: PanelDefinition,
  panels: PanelDefinition[],
  material?: MaterialDefinition,
  socketPatterns: SocketPattern[] = [],
  crossJoints: CrossJointDefinition[] = [],
): DesignIntegrityFinding[] {
  if (!panel.cuts.length) return []
  const shape = panel.shape ?? { type: 'rectangle' as const }
  // Complex/free contours require a worker-backed contour analysis. Never run
  // their CSG evaluation in the interactive React update path.
  if (shape.type !== 'rectangle' || shape.editedFaces?.length) return []
  const findings: DesignIntegrityFinding[] = []

  const separatingCuts = separatingCutIds(panel)
  if (separatingCuts.length) {
    findings.push({
      id: `${panel.id}:split`,
      panelId: panel.id,
      panelLabel: panel.label,
      severity: 'error',
      title: 'Bauteil wird in mehrere Teile getrennt',
      detail:
        'Eine durchgehende Kette sich berührender oder überlappender Aussparungen reicht von einer Bauteilkante bis zur gegenüberliegenden Kante.',
      cutIds: separatingCuts,
    })
  }

  const thin = thinAxis(panel)
  const planeAxes = ([0, 1, 2] as const).filter((axis) => axis !== thin)

  // Deliberate clearance belongs to the socket and must not be mistaken for
  // a mismatch. Compare the designed material thickness with the actually
  // connected panel thickness instead of comparing the two cut widths.
  for (const socketCut of panel.cuts.filter((cut) => cut.socketPatternId)) {
    const pattern = socketPatterns.find(
      (candidate) => candidate.id === socketCut.socketPatternId,
    )
    if (pattern?.targetThickness === undefined) continue
    for (const jointCut of panel.cuts.filter((cut) => cut.jointId)) {
      const overlaps = [pattern.distributionAxis, pattern.slotAxis].every(
        (axis) =>
          Math.abs(socketCut.center[axis] - jointCut.center[axis]) <=
          (socketCut.size[axis] + jointCut.size[axis]) / 2 + 0.001,
      )
      if (!overlaps) continue
      const joint = crossJoints.find(
        (candidate) => candidate.id === jointCut.jointId,
      )
      const connectedPanelId =
        joint?.firstPanelId === panel.id
          ? joint.secondPanelId
          : joint?.secondPanelId === panel.id
            ? joint.firstPanelId
            : undefined
      const connectedPanel = panels.find(
        (candidate) => candidate.id === connectedPanelId,
      )
      if (!connectedPanel) continue
      const actualThickness = connectedPanel.size[thinAxis(connectedPanel)]
      const difference = pattern.targetThickness - actualThickness
      if (Math.abs(difference) <= 0.01) continue
      findings.push({
        id: `${panel.id}:${socketCut.id}:${jointCut.id}:fit`,
        panelId: panel.id,
        panelLabel: panel.label,
        severity: 'measurement',
        title:
          difference > 0
            ? 'Steckplatz für dickeres Material vorgesehen'
            : 'Steckplatz für dünneres Material vorgesehen',
        detail:
          difference > 0
            ? `Die Aufnahme wurde für ${pattern.targetThickness.toFixed(2)} mm Material angelegt. Das verbundene Bauteil „${connectedPanel.label}“ ist ${actualThickness.toFixed(2)} mm stark. Das definierte Spiel von ${(pattern.clearance ?? pattern.slotWidth - pattern.targetThickness).toFixed(2)} mm ist dabei bereits berücksichtigt.`
            : `Die Aufnahme wurde für ${pattern.targetThickness.toFixed(2)} mm Material angelegt. Das verbundene Bauteil „${connectedPanel.label}“ ist ${actualThickness.toFixed(2)} mm stark und passt deshalb nicht in diese Aufnahme.`,
        remainingWidth: difference,
        cutIds: [socketCut.id, jointCut.id],
      })
    }
  }

  for (const depthAxis of planeAxes) {
    const distributionAxis = planeAxes.find((axis) => axis !== depthAxis)!
    const low = -panel.size[depthAxis] / 2
    const high = panel.size[depthAxis] / 2
    for (const side of ['negative', 'positive'] as const) {
      const edgeCuts = panel.cuts.filter((cut) => {
        const cutLow = cut.center[depthAxis] - cut.size[depthAxis] / 2
        const cutHigh = cut.center[depthAxis] + cut.size[depthAxis] / 2
        return side === 'negative'
          ? cutLow <= low + 0.001 && cutHigh < high - 0.001
          : cutHigh >= high - 0.001 && cutLow > low + 0.001
      })
      if (!edgeCuts.length) continue
      const backbone = Math.min(
        ...edgeCuts.map((cut) => {
          const cutLow = cut.center[depthAxis] - cut.size[depthAxis] / 2
          const cutHigh = cut.center[depthAxis] + cut.size[depthAxis] / 2
          return side === 'negative' ? high - cutHigh : cutLow - low
        }),
      )
      const intervals = edgeCuts
        .map(
          (cut) =>
            [
              cut.center[distributionAxis] - cut.size[distributionAxis] / 2,
              cut.center[distributionAxis] + cut.size[distributionAxis] / 2,
            ] as [number, number],
        )
        .sort((first, second) => first[0] - second[0])
      const merged: [number, number][] = []
      for (const interval of intervals) {
        const previous = merged.at(-1)
        if (previous && interval[0] <= previous[1] + 0.001)
          previous[1] = Math.max(previous[1], interval[1])
        else merged.push([...interval])
      }
      const gaps = merged
        .slice(1)
        .map((interval, index) => interval[0] - merged[index][1])
      const minimumWeb = gaps.length ? Math.min(...gaps) : undefined
      const edgeName = side === 'negative' ? 'Kante A' : 'Kante B'
      if (
        material?.minimumBackbone &&
        backbone + 0.001 < material.minimumBackbone
      )
        findings.push({
          id: `${panel.id}:${depthAxis}:${side}:backbone`,
          panelId: panel.id,
          panelLabel: panel.label,
          severity: 'measurement',
          title: `Zu wenig Material hinter den Steckschlitzen an ${edgeName}`,
          detail: `Hinter ${merged.length} physisch getrennten Steckschlitzen bleiben an der schmalsten Stelle ${backbone.toFixed(2)} mm Material. Für ${material.name} sind mindestens ${material.minimumBackbone.toFixed(2)} mm hinterlegt.`,
          remainingWidth: backbone,
          cutIds: edgeCuts.map((cut) => cut.id),
        })
      if (
        material?.minimumWeb &&
        minimumWeb !== undefined &&
        minimumWeb + 0.001 < material.minimumWeb
      )
        findings.push({
          id: `${panel.id}:${depthAxis}:${side}:web`,
          panelId: panel.id,
          panelLabel: panel.label,
          severity: 'measurement',
          title: `Steg zwischen Steckschlitzen an ${edgeName} zu schmal`,
          detail: `Der schmalste Materialsteg zwischen zwei Steckschlitzen ist ${minimumWeb.toFixed(2)} mm breit. Für ${material.name} sind mindestens ${material.minimumWeb.toFixed(2)} mm hinterlegt.`,
          remainingWidth: minimumWeb,
          cutIds: edgeCuts.map((cut) => cut.id),
        })
    }
  }

  return findings
}

export function analyzeDesignIntegrity(
  panels: PanelDefinition[],
  materials: MaterialDefinition[],
  socketPatterns: SocketPattern[] = [],
  crossJoints: CrossJointDefinition[] = [],
) {
  // Older project files stored only the finished slot width. Recover the
  // originally selected stock thickness from the material library so their
  // deliberate clearance is not reported as a mismatch.
  const resolvedPatterns = socketPatterns.map((pattern) => {
    if (pattern.targetThickness !== undefined || !materials.length)
      return pattern
    const target = [...materials].sort(
      (first, second) =>
        Math.abs(first.thickness - pattern.slotWidth) -
        Math.abs(second.thickness - pattern.slotWidth),
    )[0]
    return {
      ...pattern,
      targetThickness: target.thickness,
      clearance: pattern.slotWidth - target.thickness,
    }
  })
  return panels
    .filter((panel) => !panel.hidden && panel.visible !== false)
    .flatMap((panel) =>
      analyzePanelIntegrity(
        panel,
        panels,
        materials.find((material) => material.id === panel.materialId),
        resolvedPatterns,
        crossJoints,
      ),
    )
}
