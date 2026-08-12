import { describe, expect, it } from 'vitest'
import { calculateAlignmentGuides, calculateDistanceGuides } from './alignment'
import type { PanelDefinition } from './box'

const panel = (
  id: string,
  position: [number, number, number],
): PanelDefinition => ({
  id,
  label: id,
  size: [40, 40, 3],
  position,
  rotation: [0, 0, 0],
  cuts: [],
  booleanModifiers: [],
  jointFeatures: [],
  hidden: false,
})

describe('smart alignment guides', () => {
  it('shows matching edges before the tighter snap threshold', () => {
    const moving = panel('moving', [0, 8, 0])
    const fixed = panel('fixed', [50, 0, 0])
    const guides = calculateAlignmentGuides(
      moving,
      moving.position,
      [fixed],
      12,
      3,
      80,
    )
    const yGuide = guides.find((guide) => guide.axis === 1)
    expect(yGuide?.label).toBe('Unterkante')
    expect(yGuide?.snapped).toBe(false)
  })

  it('marks a guide as snapped inside three millimetres', () => {
    const moving = panel('moving', [0, 2, 0])
    const fixed = panel('fixed', [50, 0, 0])
    expect(
      calculateAlignmentGuides(moving, moving.position, [fixed]).find(
        (guide) => guide.axis === 1,
      )?.snapped,
    ).toBe(true)
  })

  it('ignores equally aligned but spatially remote objects', () => {
    const moving = panel('moving', [0, 0, 0])
    const remote = panel('remote', [500, 0, 0])
    expect(
      calculateAlignmentGuides(moving, moving.position, [remote]),
    ).toHaveLength(0)
  })

  it('shows the nearest surface distance on both sides of every moved axis', () => {
    const moving = panel('moving', [0, 0, 0])
    const left = panel('left', [-50, 0, 0])
    const right = panel('right', [70, 0, 0])
    const above = panel('above', [0, 60, 0])
    const guides = calculateDistanceGuides(
      moving,
      [5, 5, 0],
      [left, right, above],
      new Set([0, 1]),
    )
    expect(
      guides.filter((guide) => guide.axis === 0).map((guide) => guide.label),
    ).toEqual(['15,0 mm', '25,0 mm'])
    expect(
      guides.filter((guide) => guide.axis === 1).map((guide) => guide.label),
    ).toEqual(['15,0 mm'])
  })

  it('keeps a distance guide visible across a small projection-edge movement', () => {
    const moving = panel('moving', [0, 0, 0])
    const right = panel('right', [50, 41.5, 0])

    expect(
      calculateDistanceGuides(moving, moving.position, [right], new Set([0])),
    ).toHaveLength(1)
  })

  it('measures from the visible edge of generated connection geometry', () => {
    const fixed = {
      ...panel('fixed', [0, 0, 0]),
      jointFeatures: [
        {
          id: 'extension',
          jointId: 'joint',
          operation: 'add' as const,
          shape: 'box' as const,
          center: [21.5, 0, 0] as [number, number, number],
          size: [3, 40, 3] as [number, number, number],
        },
      ],
    }
    const moving = panel('moving', [45.1, 0, 0])

    const guide = calculateDistanceGuides(
      moving,
      moving.position,
      [fixed],
      new Set([0]),
      [moving, fixed],
    )[0]
    expect(guide.label).toBe('2,1 mm')
    expect(Math.abs(guide.points[0][0] - guide.points[1][0])).toBeCloseTo(2.1)
  })
})
