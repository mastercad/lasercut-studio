import { describe, expect, it } from 'vitest'
import {
  createBoxPanels,
  defaultBox,
  thinAxis,
  type PanelDefinition,
} from './box'

describe('box geometry', () => {
  it('creates six panels using the material thickness', () => {
    const panels = createBoxPanels(defaultBox)
    expect(panels).toHaveLength(6)
    expect(panels.find((panel) => panel.id === 'front')?.size).toEqual([
      180, 120, 3,
    ])
    expect(panels.find((panel) => panel.id === 'top')?.size).toEqual([
      174, 3, 94,
    ])
  })

  it('keeps all panels as independently addressable objects', () => {
    const panels = createBoxPanels(defaultBox)
    expect(new Set(panels.map((panel) => panel.id)).size).toBe(6)
    expect(
      panels.every(
        (panel) => panel.position.length === 3 && panel.size.length === 3,
      ),
    ).toBe(true)
  })

  it('always treats Z as text depth even when an old text object has tiny planar bounds', () => {
    const text: PanelDefinition = {
      id: 'text',
      label: 'Text',
      size: [0.1, 0.1, 5],
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      cuts: [],
      booleanModifiers: [],
      jointFeatures: [],
      hidden: false,
      shape: {
        type: 'text',
        text: 'Text',
        fontFamily: 'Test',
        fontSize: 20,
        operation: 'cut',
        outline: null,
      },
    }
    expect(thinAxis(text)).toBe(2)
    expect(
      thinAxis({
        ...text,
        shape: { type: 'free', sourceType: 'text', faces: [] },
      }),
    ).toBe(2)
  })
})
