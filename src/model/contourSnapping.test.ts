import { describe, expect, it } from 'vitest'
import type { PanelDefinition } from './box'
import { contourFaceMove, contourSnapDistance } from './contourSnapping'

const panel = (
  id: string,
  position: [number, number, number],
  size: [number, number, number] = [40, 40, 3],
): PanelDefinition => ({
  id,
  label: id,
  position,
  size,
  rotation: [0, 0, 0],
  cuts: [],
  booleanModifiers: [],
  jointFeatures: [],
  hidden: false,
})

describe('contour movement snapping', () => {
  it('uses the established fixed contour capture range', () => {
    expect(contourSnapDistance).toBe(3)
  })

  it('snaps a moved contour side to a nearby object side', () => {
    const moving = panel('moving', [0, 0, 0])
    const target = panel('target', [0, 50, 0], [40, 20, 3])
    const result = contourFaceMove(
      moving,
      [
        [-20, 20],
        [20, 20],
      ],
      [0, 17],
      1,
      [target],
      4,
    )
    expect(result.delta[1]).toBe(20)
    expect(result.snapped).toBe(true)
    expect(result.guides.some((guide) => guide.label === '0,0 mm')).toBe(true)
  })

  it('shows distances for a single selected contour edge without snapping', () => {
    const moving = panel('moving', [0, 0, 0])
    const target = panel('target', [50, 0, 0], [20, 40, 3])
    const result = contourFaceMove(
      moving,
      [
        [20, 0],
        [20, 0],
      ],
      [4, 0],
      0,
      [target],
      3,
    )
    expect(result.delta).toEqual([4, 0])
    expect(result.guides.some((guide) => guide.label === '16,0 mm')).toBe(true)
  })
})
