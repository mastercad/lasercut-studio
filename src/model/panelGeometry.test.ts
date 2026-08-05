import { describe, expect, it } from 'vitest'
import {
  createEditorPanelGeometry,
  createEvaluatedPanelGeometry,
  createPanelGeometry,
  panelGeometryKey,
} from './panelGeometry'
import type { BooleanOperation, PanelDefinition } from './box'

describe('CSG panel geometry', () => {
  it('builds many rectangular connection slots through the fast editor path', () => {
    const slotted: PanelDefinition = {
      id: 'fast-slotted',
      label: 'Fast slotted',
      size: [100, 80, 3],
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      cuts: Array.from({ length: 20 }, (_, index) => ({
        id: `cut-${index}`,
        kind: 'half-lap' as const,
        center: [-47.5 + index * 5, 20, 0] as [number, number, number],
        size: [2.5, 40, 5] as [number, number, number],
      })),
      booleanModifiers: [],
      jointFeatures: [
        {
          id: 'relief',
          jointId: 'joint',
          operation: 'subtract',
          shape: 'cylinder',
          center: [0, 0, 0],
          size: [1, 1, 5],
          axis: 2,
        },
      ],
      hidden: false,
    }
    const geometry = createEditorPanelGeometry(slotted, [slotted])
    const withoutRelief = createEditorPanelGeometry(
      { ...slotted, jointFeatures: [] },
      [slotted],
    )
    expect(geometry.getAttribute('position').count).toBeGreaterThan(0)
    expect(geometry.getAttribute('position').count).toBe(
      withoutRelief.getAttribute('position').count,
    )
    geometry.computeBoundingBox()
    expect(geometry.boundingBox?.min.x).toBeCloseTo(-50)
    expect(geometry.boundingBox?.max.x).toBeCloseTo(50)
    geometry.dispose()
    withoutRelief.dispose()
  })

  it.each([
    { type: 'triangle' as const },
    { type: 'circle' as const, segments: 48 },
    { type: 'star' as const, points: 5, innerRatio: 0.45 },
    { type: 'polygon' as const, sides: 6 },
  ])('creates renderable $type geometry', (shape) => {
    const panel: PanelDefinition = {
      id: shape.type,
      label: shape.type,
      size: [80, 60, 3],
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      cuts: [],
      booleanModifiers: [],
      jointFeatures: [],
      hidden: false,
      shape,
    }
    const geometry = createPanelGeometry(panel)
    expect(geometry.getAttribute('position').count).toBeGreaterThan(0)
    geometry.dispose()
  })

  it('creates a boolean-capable solid from a text outline', () => {
    const outline = {
      width: 20,
      height: 30,
      centerX: 10,
      centerY: 15,
      commands: [
        { type: 'M' as const, x: 0, y: 0 },
        { type: 'L' as const, x: 20, y: 0 },
        { type: 'L' as const, x: 20, y: 30 },
        { type: 'L' as const, x: 0, y: 30 },
        { type: 'Z' as const },
      ],
    }
    const text: PanelDefinition = {
      id: 'text',
      label: 'Text',
      size: [20, 30, 3],
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      cuts: [],
      booleanModifiers: [],
      jointFeatures: [],
      hidden: false,
      shape: {
        type: 'text',
        text: 'I',
        fontFamily: 'Test Font',
        fontSize: 30,
        operation: 'cut',
        outline,
      },
    }
    const target: PanelDefinition = {
      id: 'target',
      label: 'Target',
      size: [80, 80, 3],
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      cuts: [],
      booleanModifiers: [
        {
          id: 'subtract-text',
          operation: 'subtract',
          toolId: text.id,
          enabled: true,
        },
      ],
      jointFeatures: [],
      hidden: false,
    }
    const geometry = createEvaluatedPanelGeometry(target, [target, text])
    expect(geometry.getAttribute('position').count).toBeGreaterThan(0)
    geometry.dispose()
  })

  it('evaluates a coplanar text subtraction without leaving coincident CSG faces', () => {
    const outline = {
      width: 20,
      height: 30,
      centerX: 10,
      centerY: 15,
      commands: [
        { type: 'M' as const, x: 0, y: 0 },
        { type: 'L' as const, x: 20, y: 0 },
        { type: 'L' as const, x: 20, y: 30 },
        { type: 'L' as const, x: 0, y: 30 },
        { type: 'Z' as const },
      ],
    }
    const text: PanelDefinition = {
      id: 'text-coplanar',
      label: 'Text',
      size: [20, 30, 3],
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      cuts: [],
      booleanModifiers: [],
      jointFeatures: [],
      hidden: true,
      shape: {
        type: 'text',
        text: 'I',
        fontFamily: 'Test Font',
        fontSize: 30,
        operation: 'cut',
        outline,
      },
    }
    const target: PanelDefinition = {
      id: 'target-coplanar',
      label: 'Target',
      size: [80, 80, 3],
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      cuts: [],
      booleanModifiers: [
        {
          id: 'subtract-coplanar-text',
          operation: 'subtract',
          toolId: text.id,
          enabled: true,
        },
      ],
      jointFeatures: [],
      hidden: false,
    }
    const started = performance.now()
    const geometry = createEvaluatedPanelGeometry(target, [target, text])
    expect(geometry.getAttribute('position').count).toBeGreaterThan(0)
    expect(performance.now() - started).toBeLessThan(1000)
    const position = geometry.getAttribute('position'),
      index = geometry.getIndex()
    const vertex = (offset: number) => (index ? index.getX(offset) : offset)
    let signedVolume = 0
    for (
      let offset = 0;
      offset < (index?.count ?? position.count);
      offset += 3
    ) {
      const a = vertex(offset),
        b = vertex(offset + 1),
        c = vertex(offset + 2)
      const ax = position.getX(a),
        ay = position.getY(a),
        az = position.getZ(a)
      const bx = position.getX(b),
        by = position.getY(b),
        bz = position.getZ(b)
      const cx = position.getX(c),
        cy = position.getY(c),
        cz = position.getZ(c)
      signedVolume +=
        ax * (by * cz - bz * cy) +
        ay * (bz * cx - bx * cz) +
        az * (bx * cy - by * cx)
    }
    expect(Math.abs(signedVolume / 6)).toBeCloseTo((80 * 80 - 20 * 30) * 3, 0)
    geometry.dispose()
  })

  it('produces renderable geometry after a through-cut', () => {
    const panel: PanelDefinition = {
      id: 'test',
      label: 'Test',
      size: [80, 100, 3],
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      cuts: [{ id: 'cut', kind: 'hole', center: [0, 0, 0], size: [20, 20, 5] }],
      booleanModifiers: [],
      jointFeatures: [],
      hidden: false,
    }
    const geometry = createPanelGeometry(panel)
    expect(geometry.getAttribute('position').count).toBeGreaterThan(0)
    geometry.computeBoundingBox()
    expect(geometry.boundingBox?.max.x).toBeCloseTo(40)
    geometry.dispose()
  })

  it.each<BooleanOperation>([
    'subtract',
    'union',
    'intersect',
    'xor',
    'reverse-subtract',
  ])(
    'evaluates the %s boolean operation from transformed objects',
    (operation) => {
      const tool: PanelDefinition = {
        id: 'tool',
        label: 'Tool',
        size: [20, 50, 5],
        position: [35, 0, 0],
        rotation: [0, 0, 0],
        cuts: [],
        booleanModifiers: [],
        jointFeatures: [],
        hidden: true,
      }
      const target: PanelDefinition = {
        id: 'target',
        label: 'Target',
        size: [80, 100, 3],
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        cuts: [],
        booleanModifiers: [
          { id: 'bool', operation, toolId: tool.id, enabled: true },
        ],
        jointFeatures: [],
        hidden: false,
      }
      const geometry = createEvaluatedPanelGeometry(target, [target, tool])
      expect(geometry.getAttribute('position').count).toBeGreaterThan(0)
      geometry.dispose()
    },
  )

  it('keeps the geometry key stable for plain object transforms', () => {
    const panel: PanelDefinition = {
      id: 'plain',
      label: 'Plain',
      size: [80, 100, 3],
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      cuts: [],
      booleanModifiers: [],
      jointFeatures: [],
      hidden: false,
    }
    const transformed = {
      ...panel,
      position: [25, 30, 40] as [number, number, number],
      rotation: [0, Math.PI / 2, 0] as [number, number, number],
    }
    expect(panelGeometryKey(panel, [panel])).toBe(
      panelGeometryKey(transformed, [transformed]),
    )
  })

  it('keeps a boolean result cached when target and tool move as one unit', () => {
    const tool: PanelDefinition = {
      id: 'tool',
      label: 'Tool',
      size: [20, 20, 5],
      position: [10, 0, 0],
      rotation: [0, 0, 0],
      cuts: [],
      booleanModifiers: [],
      jointFeatures: [],
      hidden: true,
    }
    const target: PanelDefinition = {
      id: 'target',
      label: 'Target',
      size: [80, 100, 3],
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      cuts: [],
      booleanModifiers: [
        { id: 'bool', operation: 'union', toolId: 'tool', enabled: true },
      ],
      jointFeatures: [],
      hidden: false,
    }
    const movedTool = {
      ...tool,
      position: [30, 30, 40] as [number, number, number],
    }
    const movedTarget = {
      ...target,
      position: [20, 30, 40] as [number, number, number],
    }
    expect(panelGeometryKey(target, [target, tool])).toBe(
      panelGeometryKey(movedTarget, [movedTarget, movedTool]),
    )
  })
})
