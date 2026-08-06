import { afterEach, describe, expect, it, vi } from 'vitest'
import * as opentype from 'opentype.js'
import {
  availableCommonFonts,
  bundledFontFamily,
  createBundledTextOutline,
  createSystemTextOutline,
  isFontAvailable,
  listInstalledSystemFonts,
  missingFontFamilies,
  outlineFromFont,
} from './fonts'
import { createPanelGeometry } from './panelGeometry'
import type { PanelDefinition } from './box'

describe('bundled fallback font', () => {
  afterEach(() => vi.unstubAllGlobals())

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

  it('returns no outline for empty bundled or unavailable system text', async () => {
    await expect(createBundledTextOutline('', 20)).resolves.toBeNull()
    await expect(
      createSystemTextOutline('Missing', 'Text', 20),
    ).resolves.toBeNull()
    await expect(createSystemTextOutline('Missing', '', 20)).resolves.toBeNull()
    await expect(
      createSystemTextOutline(bundledFontFamily, 'A', 10),
    ).resolves.toMatchObject({ width: expect.any(Number) })
  })

  it('detects browser fonts using canvas metrics and sanitizes quoted family names', () => {
    let font = ''
    const context = {
      get font() {
        return font
      },
      set font(value: string) {
        font = value
      },
      measureText: vi.fn(() => ({
        width: font.includes('Available') ? 200 : 100,
      })),
    }
    vi.stubGlobal('document', {
      createElement: () => ({ getContext: () => context }),
    })
    expect(isFontAvailable('Available"Font')).toBe(true)
    expect(isFontAvailable('Unavailable')).toBe(false)
    expect(availableCommonFonts()).toEqual([])
    expect(
      missingFontFamilies(['Unavailable', bundledFontFamily, 'Unavailable']),
    ).toEqual(['Unavailable'])
  })

  it('treats fonts as available when canvas APIs are unavailable', () => {
    vi.stubGlobal('document', {
      createElement: () => ({ getContext: () => null }),
    })
    expect(isFontAvailable('Anything')).toBe(true)
  })

  it('loads, deduplicates and sorts local font metadata and handles permission failures', async () => {
    const fonts = [
      {
        family: 'Zulu',
        fullName: 'Zulu Regular',
        postscriptName: 'Zulu',
        blob: vi.fn(),
      },
      {
        family: 'Alpha',
        fullName: 'Alpha Regular',
        postscriptName: 'Alpha',
        blob: vi.fn(),
      },
      {
        family: 'Zulu',
        fullName: 'Zulu Bold',
        postscriptName: 'Zulu-Bold',
        blob: vi.fn(),
      },
    ]
    vi.stubGlobal('window', { queryLocalFonts: vi.fn(async () => fonts) })
    await expect(listInstalledSystemFonts()).resolves.toEqual(['Alpha', 'Zulu'])
    vi.stubGlobal('window', {
      queryLocalFonts: vi.fn(async () => {
        throw new Error('denied')
      }),
    })
    await expect(listInstalledSystemFonts()).resolves.toEqual([])
    vi.stubGlobal('window', {})
    await expect(listInstalledSystemFonts()).resolves.toEqual([])
  })

  it('converts every OpenType path command from an installed local font', async () => {
    const font = {
      getPath: () => ({
        getBoundingBox: () => ({ x1: -2, y1: -3, x2: 8, y2: 9 }),
        commands: [
          { type: 'M', x: 0, y: 1 },
          { type: 'L', x: 2, y: 3 },
          { type: 'Q', x: 4, y: 5, x1: 1, y1: 2 },
          { type: 'C', x: 6, y: 7, x1: 1, y1: 2, x2: 3, y2: 4 },
          { type: 'Z' },
        ],
      }),
    } as unknown as opentype.Font
    expect(outlineFromFont(font, 'Abc', 12)).toEqual({
      width: 10,
      height: 12,
      centerX: 3,
      centerY: -3,
      commands: [
        { type: 'M', x: 0, y: -1 },
        { type: 'L', x: 2, y: -3 },
        { type: 'Q', x: 4, y: -5, x1: 1, y1: -2 },
        { type: 'C', x: 6, y: -7, x1: 1, y1: -2, x2: 3, y2: -4 },
        { type: 'Z' },
      ],
    })
    expect(outlineFromFont(font, '', 12)).toBeNull()

    const path = new opentype.Path()
    path.moveTo(0, 0)
    path.lineTo(500, 0)
    path.lineTo(250, 700)
    path.close()
    const generated = new opentype.Font({
      familyName: 'Test Font',
      styleName: 'Regular',
      unitsPerEm: 1000,
      ascender: 800,
      descender: -200,
      glyphs: [
        new opentype.Glyph({
          name: '.notdef',
          unicode: 0,
          advanceWidth: 500,
          path: new opentype.Path(),
        }),
        new opentype.Glyph({ name: 'A', unicode: 65, advanceWidth: 600, path }),
      ],
    })
    const blob = { arrayBuffer: vi.fn(async () => generated.toArrayBuffer()) }
    vi.stubGlobal('window', {
      queryLocalFonts: vi.fn(async () => [
        {
          family: 'Test Font',
          fullName: 'Test Font',
          postscriptName: 'TestFont',
          blob: vi.fn(async () => blob),
        },
      ]),
    })
    await listInstalledSystemFonts()
    await expect(
      createSystemTextOutline('Test Font', 'A', 20),
    ).resolves.toMatchObject({
      width: expect.any(Number),
      commands: expect.any(Array),
    })
    expect(blob.arrayBuffer).toHaveBeenCalledOnce()
  })

  it('uses the non-browser availability fallback', () => {
    vi.stubGlobal('document', undefined)
    expect(isFontAvailable('Anything')).toBe(true)
    expect(availableCommonFonts().length).toBeGreaterThan(0)
  })
})
