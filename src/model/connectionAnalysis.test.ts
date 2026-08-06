import { describe, expect, it } from 'vitest'
import { createBoxPanels, type PanelDefinition } from './box'
import { analyzeConnection } from './connectionAnalysis'
import { buildCrossJoint } from './crossJoints'

const plate = (
  id: string,
  rotation: [number, number, number],
  position: [number, number, number] = [0, 0, 0],
): PanelDefinition => ({
  id,
  label: id,
  size: [80, 100, 3],
  position,
  rotation,
  cuts: [],
  booleanModifiers: [],
  jointFeatures: [],
  hidden: false,
})

describe('connection analysis', () => {
  it('rejects parallel plates, missing overlap and spatially separated plates with precise messages', () => {
    expect(
      analyzeConnection(plate('a', [0, 0, 0]), plate('b', [0, 0, 0])).message,
    ).toMatch(/parallel/)
    expect(
      analyzeConnection(
        plate('a', [0, 0, 0]),
        plate('b', [0, Math.PI / 2, 0], [0, 200, 0]),
      ).message,
    ).toMatch(/keine gemeinsame/)
    expect(
      analyzeConnection(
        plate('a', [0, 0, 0]),
        plate('b', [0, Math.PI / 2, 0], [200, 0, 0]),
      ).message,
    ).toMatch(/schneiden oder berühren/)
  })

  it('offers finger joints only for two meeting edges', () => {
    const panels = createBoxPanels({
      width: 180,
      height: 120,
      depth: 100,
      thickness: 3,
      fingerWidth: 12,
    })
    const result = analyzeConnection(
      panels.find((panel) => panel.id === 'front')!,
      panels.find((panel) => panel.id === 'left')!,
    )
    expect(result.possible).toEqual({
      finger: true,
      tabSlot: false,
      cross: false,
    })
  })

  it('distinguishes tab-and-slot from an interior cross', () => {
    const receiver = plate('receiver', [0, Math.PI / 2, 0])
    const tPanel = plate('tab', [0, 0, 0], [-40, 0, 0])
    expect(analyzeConnection(tPanel, receiver).possible).toEqual({
      finger: false,
      tabSlot: true,
      cross: true,
    })
    expect(analyzeConnection(tPanel, receiver).message).toMatch(/Plattenkante/)
    expect(analyzeConnection(receiver, tPanel).possible).toEqual({
      finger: false,
      tabSlot: false,
      cross: true,
    })
    expect(
      analyzeConnection(plate('cross-a', [0, 0, 0]), receiver).possible.cross,
    ).toBe(true)
    expect(
      analyzeConnection(plate('cross-a', [0, 0, 0]), receiver).message,
    ).toMatch(/Plattenflächen/)
  })

  it('builds a Steckkreuz where one plate ends in a T connection', () => {
    const receiver = plate('receiver', [0, Math.PI / 2, 0])
    const divider = plate('divider', [0, 0, 0], [-40, 0, 0])

    for (const [first, second] of [
      [divider, receiver],
      [receiver, divider],
    ] as const) {
      const result = buildCrossJoint(
        first,
        second,
        { ratio: 0.5, fit: 'tight', clearance: 0 },
        `t-cross-${first.id}`,
      )
      expect('error' in result).toBe(false)
      if ('error' in result) continue
      expect(result.firstCut.kind).toBe('half-lap')
      expect(result.secondCut.kind).toBe('half-lap')
      expect(result.firstCut.jointId).toBe(result.secondCut.jointId)
    }
  })

  it('builds a removable paired Steckkreuz with an adjustable ratio', () => {
    const result = buildCrossJoint(
      plate('first', [0, 0, 0]),
      plate('second', [0, Math.PI / 2, 0]),
      { ratio: 0.65, fit: 'loose', clearance: 0 },
      'cross',
    )
    expect('error' in result).toBe(false)
    if ('error' in result) return
    expect(result.definition.ratio).toBe(0.65)
    expect(result.firstCut.jointId).toBe('cross')
    expect(result.secondCut.jointId).toBe('cross')
    expect(result.firstCut.size[1]).toBeGreaterThan(result.secondCut.size[1])
  })
})
