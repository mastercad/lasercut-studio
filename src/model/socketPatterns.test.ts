import { describe, expect, it } from 'vitest'
import { createBoxPanels, defaultBox } from './box'
import { distributedSocketInstances, socketPatternCuts } from './socketPatterns'

describe('free socket patterns', () => {
  it('distributes stable instances evenly and converts active ones to cuts', () => {
    const panel = createBoxPanels(defaultBox)[0]
    const instances = distributedSocketInstances(4, 60, (index) => `s-${index}`)
    instances[1].offset = 3
    instances[2].deleted = true
    const cuts = socketPatternCuts(
      {
        id: 'row',
        panelId: panel.id,
        name: 'Row',
        distributionAxis: 0,
        slotAxis: 1,
        center: [0, 0, 0],
        span: 60,
        slotLength: 12,
        slotWidth: 3.2,
        instances,
      },
      panel,
    )
    expect(instances.map((instance) => instance.basePosition)).toEqual([
      -30, -10, 10, 30,
    ])
    expect(cuts.map((cut) => cut.center[0])).toEqual([-30, -7, 30])
    expect(cuts[0].size).toEqual([3.2, 12, panel.size[2] + 0.2])
    expect(cuts.every((cut) => cut.socketPatternId === 'row')).toBe(true)
  })
  it('creates cross slots from the explicitly selected panel edge', () => {
    const panel = createBoxPanels(defaultBox)[0]
    const base = {
      id: 'cross-row',
      panelId: panel.id,
      name: 'Cross row',
      distributionAxis: 0 as const,
      slotAxis: 1 as const,
      center: [0, 0, 0] as [number, number, number],
      span: 0,
      slotLength: 12,
      slotWidth: 3.1,
      socketType: 'cross' as const,
      depthRatio: 0.5,
      instances: distributedSocketInstances(1, 0, () => 'socket'),
    }
    const positive = socketPatternCuts(
      { ...base, entrySide: 'positive' as const },
      panel,
    )[0]
    const negative = socketPatternCuts(
      { ...base, entrySide: 'negative' as const },
      panel,
    )[0]
    expect(positive.size[1]).toBeCloseTo(panel.size[1] / 2 + 0.1)
    expect(positive.center[1]).toBeGreaterThan(0)
    expect(negative.center[1]).toBeLessThan(0)
    expect(positive.center[1] + positive.size[1] / 2).toBeGreaterThan(
      panel.size[1] / 2,
    )
  })
})
