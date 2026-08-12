import { describe, expect, it } from 'vitest'
import { createBoxPanels, defaultBox, type PanelDefinition } from './box'
import { stretchPanelToNearestNeighbors } from './stretchPanel'

const panel = (
  id: string,
  position: [number, number, number],
  size: [number, number, number],
): PanelDefinition => ({
  id,
  label: id,
  position,
  rotation: [0, 0, 0],
  size,
  materialId: 'wood',
  hidden: false,
  shape: { type: 'rectangle' },
  cuts: [],
  jointFeatures: [],
  booleanModifiers: [],
})

describe('stretchPanelToNearestNeighbors', () => {
  it('stretches both surface dimensions to the closest surrounding panels', () => {
    const target = panel('target', [0, 0, 0], [10, 10, 3])
    const result = stretchPanelToNearestNeighbors(target, [
      target,
      panel('left', [-15, 0, 0], [10, 40, 3]),
      panel('right', [20, 0, 0], [10, 40, 3]),
      panel('bottom', [0, -20, 0], [40, 10, 3]),
      panel('top', [0, 25, 0], [40, 10, 3]),
    ])
    expect(result?.panel.position).toEqual([2.5, 2.5, 0])
    expect(result?.panel.size).toEqual([25, 35, 3])
    expect(result?.stretchedAxes).toBe(2)
  })

  it('keeps a side unchanged when there is no neighbor there', () => {
    const target = panel('target', [0, 0, 0], [10, 10, 3])
    const result = stretchPanelToNearestNeighbors(target, [
      target,
      panel('right', [20, 0, 0], [10, 40, 3]),
    ])
    expect(result?.panel.position[0]).toBe(5)
    expect(result?.panel.size[0]).toBe(20)
  })

  it('fills the free space between all four walls of a box', () => {
    const walls = createBoxPanels(defaultBox).filter(
      ({ id }) => !['top', 'bottom'].includes(id),
    )
    const target = panel('shelf', [0, 0, 0], [80, 3, 80])
    const result = stretchPanelToNearestNeighbors(target, [...walls, target])

    expect(result?.panel.position).toEqual([0, 0, 0])
    expect(result?.panel.size).toEqual([174, 3, 94])
    expect(result?.stretchedAxes).toBe(2)
  })

  it('finds boundaries without overlap in the other stretch direction', () => {
    const target = panel('target', [0, 0, 0], [10, 10, 3])
    const result = stretchPanelToNearestNeighbors(target, [
      target,
      panel('left', [-16.5, 30, 0], [3, 10, 3]),
      panel('right', [21.5, 30, 0], [3, 10, 3]),
      panel('bottom', [30, -21.5, 0], [10, 3, 3]),
      panel('top', [30, 31.5, 0], [10, 3, 3]),
    ])

    expect(result?.panel.position).toEqual([2.5, 5, 0])
    expect(result?.panel.size).toEqual([35, 50, 3])
    expect(result?.stretchedAxes).toBe(2)
  })
})
