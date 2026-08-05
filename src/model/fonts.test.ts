import { describe, expect, it } from 'vitest'
import { createBundledTextOutline } from './fonts'
import { createPanelGeometry } from './panelGeometry'
import type { PanelDefinition } from './box'

describe('bundled fallback font', () => {
  it('creates visible, filled geometry for a new text object without a system font', async () => {
    const outline = await createBundledTextOutline('Text', 20)
    expect(outline?.commands.length).toBeGreaterThan(0)
    const panel: PanelDefinition = {
      id: 'text',
      label: 'Text',
      size: [outline!.width, outline!.height, 3],
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      cuts: [],
      booleanModifiers: [],
      jointFeatures: [],
      hidden: false,
      shape: {
        type: 'text',
        text: 'Text',
        fontFamily: 'LaserCut Sans',
        fontSize: 20,
        operation: 'cut',
        outline,
      },
    }
    const geometry = createPanelGeometry(panel)
    expect(geometry.getAttribute('position').count).toBeGreaterThan(20)
    geometry.dispose()
  })
})
