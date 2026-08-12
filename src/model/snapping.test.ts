import { describe, expect, it } from 'vitest'
import { Euler, Vector3 } from 'three'
import {
  snapPanelCoplanarPosition,
  snapPanelPosition,
  snapPanelToManualCutPosition,
  snapPanelWithManualCuts,
  surfaceSnapDistance,
  worldHalfExtents,
} from './snapping'
import type { PanelDefinition } from './box'
import { buildCrossJoint } from './crossJoints'

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

  it.each([
    [51.5, 48.5],
    [-51.5, -48.5],
  ])(
    'aligns a perpendicular wall outer face with the surrounding plate at %s',
    (draggedX, expectedX) => {
      const base = {
        ...panel('base', [0, 0, 0]),
        size: [100, 100, 3] as [number, number, number],
      }
      const wall = {
        ...panel('wall', [draggedX, 0, 0]),
        size: [3, 100, 100] as [number, number, number],
      }

      const snapped = snapPanelPosition(wall, wall.position, [base], 4)

      expect(snapped[0]).toBe(expectedX)
      expect(
        snapped[0] + Math.sign(expectedX) * worldHalfExtents(wall)[0],
      ).toBe(Math.sign(expectedX) * worldHalfExtents(base)[0])
    },
  )

  it('uses an edited asymmetric contour edge for normal surface contact', () => {
    const wall = {
      ...panel('wall', [0, 0, 0]),
      size: [420, 100, 5] as [number, number, number],
      rotation: [0, Math.PI / 2, 0] as [number, number, number],
    }
    const moving = {
      ...panel('edited', [30, 0, 0]),
      size: [80, 80, 5] as [number, number, number],
      shape: {
        type: 'rectangle' as const,
        editedFaces: [
          {
            id: 'face-0',
            outer: [
              [-40, -40],
              [40, -40],
              [57.308219545305604, 63.95243735776023],
              [-44.088677681156256, 63.95243735776023],
            ] as [number, number][],
            holes: [],
          },
        ],
      },
    }

    const snapped = snapPanelPosition(moving, [42.5, 0, 0], [wall], 6)
    const edgeXAtWallTop =
      -40 + ((-44.088677681156256 + 40) * (50 + 40)) / (63.95243735776023 + 40)
    expect(snapped[0] + edgeXAtWallTop).toBeCloseTo(2.5)
  })

  it('contacts an edited slanted edge inside the actual target overlap', () => {
    const wall = {
      ...panel('wall', [-68.53367054226383, 53.5, 0]),
      size: [420, 100, 5] as [number, number, number],
      rotation: [0, Math.PI / 2, 0] as [number, number, number],
    }
    const moving = {
      ...panel('edited', [-26.03367054226382, 43.5, 83.30424396017126]),
      size: [80, 80, 5] as [number, number, number],
      shape: {
        type: 'rectangle' as const,
        editedFaces: [
          {
            id: 'face-0',
            outer: [
              [-40, -40],
              [40, -40],
              [57.308219545305604, 63.95243735776023],
              [-44.088677681156256, 63.95243735776023],
            ] as [number, number][],
            holes: [],
          },
        ],
      },
    }

    const draggedPosition: [number, number, number] = [
      -25,
      moving.position[1],
      moving.position[2],
    ]
    const snapped = snapPanelPosition(moving, draggedPosition, [wall], 6)
    const wallSurface = wall.position[0] + wall.size[2] / 2
    const wallTopInMovingSpace =
      wall.position[1] + wall.size[1] / 2 - moving.position[1]
    const edgeXAtWallTop =
      -40 +
      ((-44.088677681156256 + 40) * (wallTopInMovingSpace + 40)) /
        (63.95243735776023 + 40)

    expect(snapped[0] + edgeXAtWallTop).toBeCloseTo(wallSurface)
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
    const snapped = snapPanelToManualCutPosition(
      inserted,
      inserted.position,
      [receiver],
      2,
    )!
    expect(snapped[0]).toBeCloseTo(12)
    expect(snapped[1]).toBe(25)
  })

  it('snaps the matching dimension of a rotated panel without centring its long axis', () => {
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
    const snapped = snapPanelToManualCutPosition(
      inserted,
      inserted.position,
      [receiver],
      2,
    )!
    expect(snapped[0]).toBeCloseTo(1)
    expect(snapped[1]).toBeCloseTo(20)
  })

  it('uses the actual local recess axes instead of its world bounding box', () => {
    const rotation = [0, 0, Math.PI / 6] as [number, number, number]
    const receiver = {
      ...panel('receiver', [20, 10, 0]),
      rotation,
      cuts: [
        {
          id: 'angled-slot',
          kind: 'half-lap' as const,
          center: [12, 25, 0] as [number, number, number],
          size: [5, 50, 5] as [number, number, number],
        },
      ],
    }
    const desired = new Vector3(12.8, 25, 40)
      .applyEuler(new Euler(...rotation))
      .add(new Vector3(...receiver.position))
      .toArray() as [number, number, number]
    const inserted = {
      ...panel('inserted', desired),
      rotation,
      size: [5, 100, 80] as [number, number, number],
    }
    const expected = new Vector3(12, 25, 40)
      .applyEuler(new Euler(...rotation))
      .add(new Vector3(...receiver.position))

    const snapped = snapPanelToManualCutPosition(
      inserted,
      desired,
      [receiver],
      2,
    )!
    expect(snapped[0]).toBeCloseTo(expected.x)
    expect(snapped[1]).toBeCloseTo(expected.y)
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
      snapPanelToManualCutPosition(inserted, inserted.position, [receiver], 2),
    ).toBeNull()
  })

  it('uses manually created socket-pattern recesses as snap targets', () => {
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
      snapPanelToManualCutPosition(
        inserted,
        inserted.position,
        [receiver],
        2,
      )?.[0],
    ).toBeCloseTo(12)
  })

  it('centres a panel in the clearance of a slightly wider manual recess', () => {
    const receiver = {
      ...panel('receiver', [0, 0, 0]),
      cuts: [
        {
          id: 'manual-slot-with-clearance',
          kind: 'hole' as const,
          center: [12, 25, 0] as [number, number, number],
          size: [5.2, 50, 5] as [number, number, number],
          socketPatternId: 'manual-pattern',
        },
      ],
    }
    const inserted = {
      ...panel('inserted', [12.15, 25, 40]),
      size: [5, 100, 80] as [number, number, number],
    }

    expect(
      snapPanelToManualCutPosition(
        inserted,
        inserted.position,
        [receiver],
        2,
      )?.[0],
    ).toBeCloseTo(12)
  })

  it('does not treat an oversized through-cut as a matching normal-panel dimension', () => {
    const receiver = {
      ...panel('receiver', [0, 0, 0]),
      cuts: [
        {
          id: 'oversized-csg-slot',
          kind: 'hole' as const,
          center: [12, 25, 0] as [number, number, number],
          size: [5, 20, 7] as [number, number, number],
          socketPatternId: 'manual-pattern',
        },
      ],
    }
    const inserted = {
      ...panel('inserted', [12.4, 26, 1.8]),
      size: [5, 100, 5] as [number, number, number],
    }

    const snapped = snapPanelToManualCutPosition(
      inserted,
      inserted.position,
      [receiver],
      4,
    )!
    expect(snapped[0]).toBeCloseTo(12)
    expect(snapped[1]).toBe(26)
    expect(snapped[2]).toBe(1.8)
  })

  it('aligns a plain panel with a recess while keeping its end against the wall surface', () => {
    const wall = {
      ...panel('wall', [0, 0, 0]),
      size: [20, 100, 100] as [number, number, number],
      cuts: [
        {
          id: 'edge-recess',
          kind: 'hole' as const,
          center: [7, 12, 0] as [number, number, number],
          size: [6, 5, 8] as [number, number, number],
          socketPatternId: 'manual-pattern',
        },
      ],
    }
    const inserted = {
      ...panel('inserted', [18, 12.4, 0]),
      size: [20, 5, 20] as [number, number, number],
    }

    const snapped = snapPanelWithManualCuts(
      inserted,
      inserted.position,
      [wall],
      2,
    )
    expect(snapped[0]).toBeCloseTo(20)
    expect(snapped[1]).toBeCloseTo(12)
    expect(snapped[2]).toBeCloseTo(0)
  })

  it('does not centre a long panel on the short depth of an edge recess', () => {
    const receiver = {
      ...panel('receiver', [0, 0, 0]),
      cuts: [
        {
          id: 'short-edge-slot',
          kind: 'hole' as const,
          center: [12, 25, 0] as [number, number, number],
          size: [5, 20, 5] as [number, number, number],
        },
      ],
    }
    const inserted = {
      ...panel('inserted', [12.4, 26, 40]),
      size: [5, 100, 80] as [number, number, number],
    }

    const snapped = snapPanelToManualCutPosition(
      inserted,
      inserted.position,
      [receiver],
      2,
    )!
    expect(snapped[0]).toBeCloseTo(12)
    expect(snapped[1]).toBe(26)
  })

  it.each([-15, 65])(
    'does not pull either end of a long panel onto a short recess edge at %s',
    (longAxisPosition) => {
      const receiver = {
        ...panel('receiver', [0, 0, 0]),
        cuts: [
          {
            id: 'short-edge-slot',
            kind: 'hole' as const,
            center: [12, 25, 0] as [number, number, number],
            size: [5, 20, 5] as [number, number, number],
          },
        ],
      }
      const inserted = {
        ...panel('inserted', [12.4, longAxisPosition, 40]),
        size: [5, 100, 80] as [number, number, number],
      }

      const snapped = snapPanelToManualCutPosition(
        inserted,
        inserted.position,
        [receiver],
        2,
      )!
      expect(snapped[0]).toBeCloseTo(12)
      expect(snapped[1]).toBe(longAxisPosition)
    },
  )

  it('aligns a moving panel by its offset dynamic recess', () => {
    const receiver = {
      ...panel('receiver', [0, 0, 0]),
      cuts: [
        {
          id: 'manual-slot',
          kind: 'half-lap' as const,
          center: [12, 25, 0] as [number, number, number],
          size: [5, 20, 5] as [number, number, number],
        },
      ],
    }
    const inserted = {
      ...panel('inserted', [2.8, 0, 0]),
      size: [5, 100, 80] as [number, number, number],
      cuts: [
        {
          id: 'moving-cross-slot',
          kind: 'half-lap' as const,
          jointId: 'existing-cross-joint',
          center: [10, 25, 0] as [number, number, number],
          size: [5, 20, 5] as [number, number, number],
        },
      ],
    }

    expect(
      snapPanelToManualCutPosition(inserted, inserted.position, [receiver], 2),
    ).toEqual([2, 0, 0])
  })

  it('uses a subtractive joint feature as the moving recess anchor', () => {
    const receiver = {
      ...panel('receiver', [0, 0, 0]),
      cuts: [
        {
          id: 'manual-slot',
          kind: 'hole' as const,
          center: [12, 25, 0] as [number, number, number],
          size: [5, 20, 5] as [number, number, number],
        },
      ],
    }
    const inserted = {
      ...panel('inserted', [2.8, 0, 0]),
      jointFeatures: [
        {
          id: 'moving-finger-slot',
          jointId: 'existing-finger-joint',
          operation: 'subtract' as const,
          shape: 'box' as const,
          center: [10, 25, 0] as [number, number, number],
          size: [5, 20, 5] as [number, number, number],
        },
      ],
    }

    expect(
      snapPanelToManualCutPosition(inserted, inserted.position, [receiver], 2),
    ).toEqual([2, 0, 0])
  })

  it.each([-1.5, 1.5])(
    'snaps a generated dynamic cross recess into a fixed recess from offset %s',
    (approachOffset) => {
      const movingBase = {
        ...panel('moving', [0, 0, 0]),
        size: [80, 100, 5] as [number, number, number],
      }
      const jointPartner = {
        ...panel('joint-partner', [0, 0, 0]),
        size: [5, 100, 80] as [number, number, number],
      }
      const built = buildCrossJoint(
        movingBase,
        jointPartner,
        { ratio: 0.5, fit: 'tight', clearance: 0 },
        'generated-cross-joint',
      )
      expect('error' in built).toBe(false)
      if ('error' in built) return

      const intendedPosition: [number, number, number] = [40, -15, 20]
      const moving = {
        ...movingBase,
        position: [
          intendedPosition[0] + approachOffset,
          intendedPosition[1],
          intendedPosition[2],
        ] as [number, number, number],
        cuts: [built.firstCut],
      }
      const fixedRecess = {
        ...panel('fixed-recess', [0, 0, 0]),
        cuts: [
          {
            id: 'fixed-slot',
            kind: 'half-lap' as const,
            center: built.firstCut.center.map(
              (value, axis) => value + intendedPosition[axis],
            ) as [number, number, number],
            size: built.firstCut.size,
          },
        ],
      }

      expect(
        snapPanelToManualCutPosition(moving, moving.position, [fixedRecess], 2),
      ).toEqual(intendedPosition)
    },
  )

  it('keeps generated dynamic-to-fixed recess snapping exact under rotation', () => {
    const movingBase = {
      ...panel('moving', [0, 0, 0]),
      size: [80, 100, 5] as [number, number, number],
    }
    const jointPartner = {
      ...panel('joint-partner', [0, 0, 0]),
      size: [5, 100, 80] as [number, number, number],
    }
    const built = buildCrossJoint(
      movingBase,
      jointPartner,
      { ratio: 0.5, fit: 'tight', clearance: 0 },
      'generated-rotated-cross-joint',
    )
    expect('error' in built).toBe(false)
    if ('error' in built) return

    const rotation = [0, 0, Math.PI / 6] as [number, number, number]
    const targetPosition = [30, 20, 10] as [number, number, number]
    const intendedPosition = new Vector3(12, -7, 4)
      .applyEuler(new Euler(...rotation))
      .add(new Vector3(...targetPosition))
    const approach = new Vector3(1.5, 0, 0).applyEuler(new Euler(...rotation))
    const moving = {
      ...movingBase,
      rotation,
      position: intendedPosition.clone().add(approach).toArray() as [
        number,
        number,
        number,
      ],
      cuts: [built.firstCut],
    }
    const fixedRecess = {
      ...panel('fixed-recess', targetPosition),
      rotation,
      cuts: [
        {
          id: 'fixed-rotated-slot',
          kind: 'half-lap' as const,
          center: built.firstCut.center.map((value, axis) =>
            axis === 0 ? value + 12 : axis === 1 ? value - 7 : value + 4,
          ) as [number, number, number],
          size: built.firstCut.size,
        },
      ],
    }

    const snapped = snapPanelToManualCutPosition(
      moving,
      moving.position,
      [fixedRecess],
      2,
    )!
    expect(new Vector3(...snapped).distanceTo(intendedPosition)).toBeLessThan(
      1e-8,
    )
  })

  it('keeps manual-cut targets out of normal object snapping', () => {
    const receiver = {
      ...panel('receiver', [0, 0, 0]),
      cuts: [
        {
          id: 'manual-slot',
          kind: 'hole' as const,
          center: [12, 25, 0] as [number, number, number],
          size: [3, 50, 5] as [number, number, number],
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
