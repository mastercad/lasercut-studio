import { describe, expect, it } from 'vitest'
import {
  snapPanelCoplanarPosition,
  snapPanelPosition,
  surfaceSnapDistance,
  worldHalfExtents,
} from './snapping'
import type { PanelDefinition } from './box'

const panel = (
  id: string,
  position: [number, number, number],
): PanelDefinition => ({
  id,
  label: id,
  size: [80, 100, 3],
  position,
  rotation: [0, 0, 0],
  cuts: [],
  booleanModifiers: [],
  jointFeatures: [],
  hidden: false,
})

describe('surface snapping', () => {
  it('snaps a nearby face exactly onto another panel face', () => {
    const fixed = panel('fixed', [0, 0, 0])
    const moving = panel('moving', [0, 0, 7])
    const snapped = snapPanelPosition(moving, [0, 0, 7], [fixed], 6)
    expect(snapped[2]).toBe(3)
  })

  it('uses rotated world extents', () => {
    const rotated = {
      ...panel('rotated', [0, 0, 0]),
      rotation: [0, Math.PI / 2, 0] as [number, number, number],
    }
    expect(worldHalfExtents(rotated)[0]).toBeCloseTo(1.5)
    expect(worldHalfExtents(rotated)[2]).toBeCloseTo(40)
  })

  it('snaps matching faces and edges on multiple axes in one movement', () => {
    const fixed = panel('fixed', [0, 0, 0])
    const moving = panel('moving', [86, 7, 9])
    const snapped = snapPanelPosition(moving, moving.position, [fixed], 12)
    expect(snapped).toEqual([80, 0, 3])
  })

  it('keeps surface contact instead of snapping the moving panel inside', () => {
    const moving = {
      ...panel('moving', [-30, 0, 0]),
      size: [10, 20, 3] as [number, number, number],
    }
    const fixed = {
      ...panel('fixed', [0, 0, 0]),
      size: [20, 30, 3] as [number, number, number],
    }

    expect(snapPanelPosition(moving, [-11, 0, 0], [fixed], 4)).toEqual([
      -15, 0, 0,
    ])
  })

  it('scales the capture distance proportionally to the object surface', () => {
    const small = {
      ...panel('small', [0, 0, 0]),
      size: [10, 10, 3] as [number, number, number],
    }
    const regular = panel('regular', [0, 0, 0])
    const huge = {
      ...panel('huge', [0, 0, 0]),
      size: [1000, 800, 5] as [number, number, number],
    }
    expect(surfaceSnapDistance(small)).toBe(0.5)
    expect(surfaceSnapDistance(regular)).toBe(4)
    expect(surfaceSnapDistance(huge)).toBe(10)
  })

  it('uses a practical capture distance for imported SVG laser parts', () => {
    const imported = {
      ...panel('svg', [0, 0, 0]),
      size: [42, 27, 3] as [number, number, number],
      shape: { type: 'free' as const, sourceType: 'svg', faces: [] },
    }
    expect(surfaceSnapDistance(imported)).toBe(4)
  })

  it('snaps a panel edge to the near surface of a perpendicular panel for a T joint', () => {
    const divider = panel('divider', [-4, 0, 0])
    const receiver = {
      ...panel('receiver', [40, 0, 0]),
      size: [3, 100, 80] as [number, number, number],
    }
    const snapped = snapPanelPosition(divider, divider.position, [receiver])
    const receiverNearSurface =
      receiver.position[0] - worldHalfExtents(receiver)[0]
    expect(snapped[0]).toBe(-1.5)
    expect(snapped[0] + worldHalfExtents(divider)[0]).toBe(receiverNearSurface)
  })

  it('aligns matching surface sides to the same plane for boolean preparation', () => {
    const fixed = panel('fixed', [0, 0, 0])
    const moving = {
      ...panel('moving', [15, 10, 1]),
      size: [30, 40, 3] as [number, number, number],
    }
    const snapped = snapPanelCoplanarPosition(
      moving,
      moving.position,
      [fixed],
      3,
    )
    expect(snapped[2]).toBe(0)
    expect(snapped[2] + worldHalfExtents(moving)[2]).toBe(
      fixed.position[2] + worldHalfExtents(fixed)[2],
    )
  })

  it('centres a panel in a fixed recess', () => {
    const receiver = {
      ...panel('receiver', [0, 0, 0]),
      cuts: [
        {
          id: 'cross-slot',
          kind: 'half-lap' as const,
          center: [12, 25, 0] as [number, number, number],
          size: [3, 50, 5] as [number, number, number],
        },
      ],
    }
    const inserted = {
      ...panel('inserted', [13.4, 25, 40]),
      size: [3, 100, 80] as [number, number, number],
    }
    const snapped = snapPanelPosition(
      inserted,
      inserted.position,
      [receiver],
      2,
    )
    expect(snapped[0]).toBeCloseTo(12)
    expect(snapped[1]).toBe(25)
  })

  it('snaps to a fixed recess on a rotated panel in world coordinates', () => {
    const receiver = {
      ...panel('receiver', [20, 10, 0]),
      rotation: [0, 0, Math.PI / 2] as [number, number, number],
      cuts: [
        {
          id: 'rotated-cross-slot',
          kind: 'half-lap' as const,
          center: [10, 20, 0] as [number, number, number],
          size: [4, 30, 5] as [number, number, number],
        },
      ],
    }
    const inserted = {
      ...panel('inserted', [1, 21.5, 40]),
      size: [100, 4, 80] as [number, number, number],
    }
    const snapped = snapPanelPosition(
      inserted,
      inserted.position,
      [receiver],
      2,
    )
    expect(snapped[0]).toBeCloseTo(0)
    expect(snapped[1]).toBeCloseTo(20)
  })

  it('does not use dynamically generated joint recesses as snap targets', () => {
    const receiver = {
      ...panel('receiver', [0, 0, 0]),
      cuts: [
        {
          id: 'dynamic-slot',
          kind: 'half-lap' as const,
          center: [12, 25, 0] as [number, number, number],
          size: [3, 50, 5] as [number, number, number],
          jointId: 'cross-joint',
        },
      ],
    }
    const inserted = {
      ...panel('inserted', [13.4, 25, 40]),
      size: [3, 100, 80] as [number, number, number],
    }

    expect(
      snapPanelPosition(inserted, inserted.position, [receiver], 2)[0],
    ).toBe(13.4)
  })

  it('does not use dynamically generated socket-pattern recesses as snap targets', () => {
    const receiver = {
      ...panel('receiver', [0, 0, 0]),
      cuts: [
        {
          id: 'dynamic-socket',
          kind: 'hole' as const,
          center: [12, 25, 0] as [number, number, number],
          size: [3, 50, 5] as [number, number, number],
          socketPatternId: 'socket-pattern',
        },
      ],
    }
    const inserted = {
      ...panel('inserted', [13.4, 25, 40]),
      size: [3, 100, 80] as [number, number, number],
    }

    expect(
      snapPanelPosition(inserted, inserted.position, [receiver], 2)[0],
    ).toBe(13.4)
  })
})
