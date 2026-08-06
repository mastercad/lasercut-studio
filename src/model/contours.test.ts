import { describe, expect, it } from 'vitest'
import { createPanelGeometry } from './panelGeometry'
import {
  contourShapes,
  shapeToFreeContour,
  textOutlineShapes,
} from './contours'
import type { PanelDefinition, TextOutline } from './box'

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

  it.each([
    [{ type: 'rectangle' } as const, 4],
    [{ type: 'triangle' } as const, 3],
    [{ type: 'circle', segments: 8 } as const, 16],
    [{ type: 'polygon', sides: 7 } as const, 7],
    [{ type: 'star', points: 5, innerRatio: 0.4 } as const, 10],
  ])(
    'converts every parametric primitive without mutating it',
    (shape, points) => {
      const source = panel([40, 30, 3], shape)
      const result = shapeToFreeContour(source)
      expect(result.sourceType).toBe(shape.type)
      expect(result.faces[0].outer).toHaveLength(points)
      expect(source.shape).toEqual(shape)
    },
  )

  it('deep-clones free and edited contours including holes', () => {
    const faces = [
      {
        id: 'face',
        outer: [
          [0, 0],
          [10, 0],
          [10, 10],
        ] as [number, number][],
        holes: [
          [
            [2, 2],
            [3, 2],
            [3, 3],
          ],
        ] as [number, number][][],
      },
    ]
    for (const shape of [
      { type: 'free', sourceType: 'rectangle', faces } as const,
      { type: 'rectangle', editedFaces: faces } as const,
    ]) {
      const converted = shapeToFreeContour(panel([10, 10, 3], shape))
      converted.faces[0].outer[0][0] = 99
      converted.faces[0].holes[0][0][0] = 99
      expect(faces[0].outer[0][0]).toBe(0)
      expect(faces[0].holes[0][0][0]).toBe(2)
    }
  })

  it('converts text outlines with line, cubic, quadratic and close commands into filled faces', () => {
    const outline: TextOutline = {
      width: 20,
      height: 20,
      centerX: 10,
      centerY: 10,
      commands: [
        { type: 'M', x: 0, y: 0 },
        { type: 'L', x: 20, y: 0 },
        { type: 'C', x: 20, y: 20, x1: 25, y1: 5, x2: 25, y2: 15 },
        { type: 'Q', x: 0, y: 20, x1: 10, y1: 25 },
        { type: 'Z' },
      ],
    }
    const shapes = textOutlineShapes(outline)
    expect(shapes.length).toBeGreaterThan(0)
    const converted = shapeToFreeContour(
      panel([20, 20, 3], {
        type: 'text',
        text: 'A',
        fontFamily: 'Test',
        fontSize: 20,
        operation: 'cut',
        outline,
      }),
    )
    expect(converted.sourceType).toBe('text')
    expect(converted.faces[0].outer.length).toBeGreaterThan(3)
  })

  it('falls back to a rectangle for text without an outline and builds Three shapes with holes', () => {
    const converted = shapeToFreeContour(
      panel([20, 10, 3], {
        type: 'text',
        text: '',
        fontFamily: 'Test',
        fontSize: 20,
        operation: 'cut',
        outline: null,
      }),
    )
    expect(converted.faces[0].outer).toHaveLength(4)
    const shapes = contourShapes([
      {
        id: 'face',
        outer: [
          [0, 0],
          [20, 0],
          [20, 20],
          [0, 20],
        ],
        holes: [
          [
            [5, 5],
            [5, 10],
            [10, 10],
            [10, 5],
          ],
        ],
      },
    ])
    expect(shapes).toHaveLength(1)
    expect(shapes[0].holes).toHaveLength(1)
  })
})
