import { describe, expect, it } from 'vitest'
import type { MaterialDefinition, PanelDefinition } from './box'
import { analyzePanelIntegrity } from './designIntegrity'

const panel = (cuts: PanelDefinition['cuts']): PanelDefinition => ({
  id: 'test-panel',
  label: 'Testplatte',
  size: [100, 40, 3],
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  cuts,
  booleanModifiers: [],
  jointFeatures: [],
  hidden: false,
  visible: true,
  materialId: 'wood',
})

describe('live design integrity analysis', () => {
  it('does not report the tautological section of one half-depth edge slot', () => {
    const subject = panel([
      {
        id: 'half-slot',
        kind: 'hole',
        center: [0, 10.05, 0],
        size: [4, 20.1, 3.2],
      },
    ])
    expect(
      analyzePanelIntegrity(subject, [subject]).some(
        (entry) => entry.severity === 'measurement',
      ),
    ).toBe(false)
  })

  it('compares real backbone and web dimensions with material limits', () => {
    const subject = panel([
      {
        id: 'left-slot',
        kind: 'hole',
        center: [-5, 10.5, 0],
        size: [4, 19, 3.2],
      },
      {
        id: 'right-slot',
        kind: 'hole',
        center: [5, 10.5, 0],
        size: [4, 19, 3.2],
      },
    ])
    const material: MaterialDefinition = {
      id: 'wood',
      name: 'Testholz',
      thickness: 3,
      kerf: 0.15,
      color: '#fff',
      minimumBackbone: 22,
      minimumWeb: 7,
    }
    const findings = analyzePanelIntegrity(subject, [subject], material)
    expect(
      findings.find((entry) => entry.id.endsWith(':backbone'))?.remainingWidth,
    ).toBeCloseTo(21)
    expect(
      findings.find((entry) => entry.id.endsWith(':web'))?.remainingWidth,
    ).toBeCloseTo(6)
  })

  it('treats coincident dynamic and persistent cuts as one physical cut', () => {
    const subject = panel([
      {
        id: 'persistent-socket',
        kind: 'hole',
        center: [0, 10, 0],
        size: [4, 20, 3.2],
        socketPatternId: 'pattern',
      },
      {
        id: 'dynamic-joint',
        kind: 'half-lap',
        center: [0, 10, 0],
        size: [4, 20, 3.2],
        jointId: 'joint',
      },
    ])
    expect(
      analyzePanelIntegrity(subject, [subject]).some((entry) =>
        entry.id.endsWith(':weakest-section'),
      ),
    ).toBe(false)
  })

  it('compares socket target thickness while accepting defined clearance', () => {
    const receiver = panel([
      {
        id: 'five-mm-socket',
        kind: 'hole',
        center: [0, 10, 0],
        size: [5, 20, 3.2],
        socketPatternId: 'fixed-pattern',
      },
      {
        id: 'three-mm-joint',
        kind: 'half-lap',
        center: [0, 10, 0],
        size: [3, 20, 3.2],
        jointId: 'dynamic-joint',
      },
    ])
    const inserted = {
      ...panel([]),
      id: 'inserted-panel',
      label: 'Einsatz',
      size: [40, 20, 3] as [number, number, number],
    }
    const pattern = {
      id: 'fixed-pattern',
      panelId: receiver.id,
      name: '5-mm-Aufnahme',
      distributionAxis: 0 as const,
      slotAxis: 1 as const,
      center: [0, 0, 0] as [number, number, number],
      span: 0,
      slotLength: 20,
      slotWidth: 5.2,
      targetThickness: 5,
      clearance: 0.2,
      instances: [],
    }
    const joint = {
      id: 'dynamic-joint',
      firstPanelId: receiver.id,
      secondPanelId: inserted.id,
      ratio: 0.5,
      fit: 'tight' as const,
      clearance: 0,
    }
    const finding = analyzePanelIntegrity(
      receiver,
      [receiver, inserted],
      undefined,
      [pattern],
      [joint],
    ).find((entry) => entry.id.endsWith(':fit'))
    expect(finding?.detail).toContain('für 5.00 mm Material')
    expect(finding?.detail).toContain('ist 3.00 mm stark')
    expect(finding?.detail).toContain('Spiel von 0.20 mm')

    const matching = {
      ...inserted,
      size: [40, 20, 5] as [number, number, number],
    }
    expect(
      analyzePanelIntegrity(
        receiver,
        [receiver, matching],
        undefined,
        [pattern],
        [joint],
      ).some((entry) => entry.id.endsWith(':fit')),
    ).toBe(false)
  })

  it('detects when opposing slots join into a separating cut', () => {
    const subject = panel([
      {
        id: 'upper-slot',
        kind: 'hole',
        center: [0, 10, 0],
        size: [4, 20.2, 3.2],
      },
      {
        id: 'lower-slot',
        kind: 'hole',
        center: [0, -10, 0],
        size: [4, 20.2, 3.2],
      },
    ])
    const findings = analyzePanelIntegrity(subject, [subject])
    expect(findings.some((entry) => entry.id.endsWith(':split'))).toBe(true)
  })

  it('does not invent findings for an uncut plate', () => {
    const subject = panel([])
    expect(analyzePanelIntegrity(subject, [subject])).toEqual([])
  })
})
