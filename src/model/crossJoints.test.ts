import { describe, expect, it } from 'vitest'
import type { PanelDefinition } from './box'
import { buildCrossJoint } from './crossJoints'

const panel = (
  id: string,
  size: [number, number, number],
  position: [number, number, number],
): PanelDefinition => ({
  id,
  label: id,
  size,
  position,
  rotation: [0, 0, 0],
  cuts: [],
  booleanModifiers: [],
  jointFeatures: [],
  hidden: false,
})

describe('cross joints', () => {
  it('extends the striking panel into the receiver for a T connection', () => {
    const striking = panel('striking', [80, 100, 3], [0, 0, 0])
    const receiver = panel('receiver', [3, 100, 80], [40, 0, 0])

    const result = buildCrossJoint(
      striking,
      receiver,
      { ratio: 0.5, fit: 'tight', clearance: 0 },
      't-cross',
    )

    expect('error' in result).toBe(false)
    if ('error' in result) return
    expect(result.firstFeatures).toHaveLength(1)
    expect(result.firstFeatures[0]).toMatchObject({
      jointId: 't-cross',
      operation: 'add',
      shape: 'box',
    })
    expect(result.firstFeatures[0].size).toEqual([3, 50, 3])
    expect(result.firstFeatures[0].center[1]).toBe(-25)
    expect(result.secondFeatures).toHaveLength(0)
  })

  it('places a T connection extension inside an offset overlap', () => {
    const striking = panel('striking-offset', [80, 100, 3], [0, 70, 0])
    const receiver = panel('receiver-offset', [3, 100, 80], [40, 70, 0])

    const result = buildCrossJoint(
      striking,
      receiver,
      { ratio: 0.5, fit: 'tight', clearance: 0 },
      'offset-cross',
    )

    expect('error' in result).toBe(false)
    if ('error' in result) return
    expect(result.firstFeatures).toHaveLength(1)
    expect(result.firstFeatures[0].size[1]).toBe(50)
    expect(result.firstFeatures[0].center[1]).toBe(-25)
    const firstCut = result.firstCut
    const secondCut = result.secondCut
    expect(firstCut.center[1] - firstCut.size[1] / 2).toBeCloseTo(
      secondCut.center[1] + secondCut.size[1] / 2,
    )
  })

  it('moves the visible T extension from bottom to top when the order is reversed', () => {
    const striking = panel('striking', [80, 100, 3], [0, 0, 0])
    const receiver = panel('receiver', [3, 100, 80], [40, 0, 0])
    const normal = buildCrossJoint(
      striking,
      receiver,
      { ratio: 0.5, fit: 'tight', clearance: 0 },
      'normal',
    )
    const reversed = buildCrossJoint(
      receiver,
      striking,
      { ratio: 0.5, fit: 'tight', clearance: 0 },
      'reversed',
    )

    expect('error' in normal).toBe(false)
    expect('error' in reversed).toBe(false)
    if ('error' in normal || 'error' in reversed) return
    expect(normal.firstFeatures[0].center[1]).toBeLessThan(0)
    expect(reversed.secondFeatures[0].center[1]).toBeGreaterThan(0)
  })

  it('moves the T extension to the selected side without changing plate order', () => {
    const striking = panel('striking-direction', [80, 100, 3], [0, 0, 0])
    const receiver = panel('receiver-direction', [3, 100, 80], [40, 0, 0])
    const bottom = buildCrossJoint(
      striking,
      receiver,
      { ratio: 0.5, fit: 'tight', clearance: 0, firstFromHigh: true },
      'bottom',
    )
    const top = buildCrossJoint(
      striking,
      receiver,
      { ratio: 0.5, fit: 'tight', clearance: 0, firstFromHigh: false },
      'top',
    )

    expect('error' in bottom).toBe(false)
    expect('error' in top).toBe(false)
    if ('error' in bottom || 'error' in top) return
    expect(bottom.firstFeatures[0].center[1]).toBeLessThan(0)
    expect(top.firstFeatures[0].center[1]).toBeGreaterThan(0)
    expect(bottom.firstCut.center[1]).toBeGreaterThan(0)
    expect(top.firstCut.center[1]).toBeLessThan(0)
  })

  it('does not add material when both panels cross through one another', () => {
    const first = panel('first', [80, 100, 3], [0, 0, 0])
    const second = panel('second', [3, 100, 80], [0, 0, 0])

    const result = buildCrossJoint(
      first,
      second,
      { ratio: 0.5, fit: 'tight', clearance: 0 },
      'cross',
    )

    expect('error' in result).toBe(false)
    if ('error' in result) return
    expect(result.firstFeatures).toHaveLength(0)
    expect(result.secondFeatures).toHaveLength(0)
  })
})
