import { describe, expect, it } from 'vitest'
import { createPanelGeometry } from './panelGeometry'
import { shapeToFreeContour } from './contours'
import type { PanelDefinition } from './box'

const panel = (
  size: [number, number, number],
  shape: PanelDefinition['shape'],
): PanelDefinition => ({
  id: 'test',
  label: 'Test',
  size,
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  cuts: [],
  booleanModifiers: [],
  jointFeatures: [],
  hidden: false,
  shape,
})

describe('laser-safe free contours', () => {
  it('converts both primitive and text-capable objects to editable contour faces', () => {
    const converted = shapeToFreeContour(
      panel([40, 30, 3], { type: 'star', points: 6, innerRatio: 0.4 }),
    )
    expect(converted.faces).toHaveLength(1)
    expect(converted.faces[0].outer).toHaveLength(12)
  })

  it('extrudes the same contour through thickness on a side-oriented panel', () => {
    const source = panel([3, 30, 40], { type: 'triangle' })
    const geometry = createPanelGeometry({
      ...source,
      shape: shapeToFreeContour(source),
    })
    const xValues = Array.from(
      geometry.getAttribute('position').array as ArrayLike<number>,
    ).filter((_, index) => index % 3 === 0)
    expect(Math.min(...xValues)).toBeCloseTo(-1.5)
    expect(Math.max(...xValues)).toBeCloseTo(1.5)
    expect(new Set(xValues.map((value) => value.toFixed(5)))).toEqual(
      new Set(['-1.50000', '1.50000']),
    )
  })
})
