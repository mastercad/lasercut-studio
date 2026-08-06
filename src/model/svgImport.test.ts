// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  parseDxfImport,
  parseLbrn2Import,
  parseLbrnImport,
  parseSvgImport,
} from './svgImport'

describe('SVG import', () => {
  it('reads physical dimensions, transformed shapes, names and colors', () => {
    const result = parseSvgImport(
      `<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="50mm" viewBox="0 0 200 100">
      <g id="Deckel"><rect id="Außenform" x="10" y="10" width="40" height="20" fill="#d9a96c" transform="translate(20 5)"/></g>
    </svg>`,
      'box.svg',
    )
    expect(result.hasReliableSize).toBe(true)
    expect(result.objects).toHaveLength(1)
    expect(result.objects[0]).toMatchObject({
      name: 'Außenform',
      groupName: 'Deckel',
      color: '#d9a96c',
    })
    expect(result.widthMm).toBeCloseTo(20)
    expect(result.heightMm).toBeCloseTo(10)
  })

  it('keeps compound-path holes, accepts closed laser hairlines and reports open lines', () => {
    const result =
      parseSvgImport(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <path id="Rahmen" fill="#123456" fill-rule="evenodd" d="M0 0H100V100H0Z M25 25V75H75V25Z"/>
      <path id="Laserschnitt" fill="none" stroke="#000" d="M30 30H70V70H30Z"/>
      <path id="Hilfslinie" fill="none" stroke="#000" d="M0 50H100"/>
    </svg>`)
    expect(result.objects).toHaveLength(2)
    expect(
      result.objects[0].faces.some((face) => face.holes.length === 1),
    ).toBe(true)
    expect(result.objects[1]).toMatchObject({
      name: 'Laserschnitt',
      color: '#000',
    })
    expect(
      result.warnings.some((warning) => warning.message.includes('Hilfslinie')),
    ).toBe(true)
    expect(result.hasReliableSize).toBe(false)
  })

  it('rejects malformed and empty SVG input with useful feedback', () => {
    expect(() => parseSvgImport('<svg><path></svg>')).toThrow(
      /beschädigt|vollständig/,
    )
    const empty = parseSvgImport(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="10mm"></svg>',
    )
    expect(empty.objects).toHaveLength(0)
    expect(empty.warnings.some((warning) => warning.kind === 'error')).toBe(
      true,
    )
  })

  it('converts LBRN2 paths into the regular import document while preserving settings', () => {
    const result = parseLbrn2Import(
      `<LightBurnProject AppVersion="1.7.07" DeviceName="GRBL" FormatVersion="1">
        <CutSetting type="Cut"><index Value="0"/><name Value="Cut"/><speed Value="500"/><maxPower Value="80"/></CutSetting>
        <Shape Type="Rect" CutIndex="0" W="20" H="10" Cr="0"><XForm>1 0 0 1 10 5</XForm></Shape>
      </LightBurnProject>`,
      'part.lbrn2',
    )
    expect(result).toMatchObject({
      fileName: 'part.lbrn2',
      sourceFormat: 'lbrn2',
      hasReliableSize: true,
      lightBurn: {
        appVersion: '1.7.07',
        deviceName: 'GRBL',
        cutSettings: [expect.objectContaining({ speed: 500, maxPower: 80 })],
      },
    })
    expect(result.convertedSvg).toContain('<svg')
    expect(result.objects).toHaveLength(1)
    expect(result.objects[0]).toMatchObject({
      name: 'Cut · Form 1',
      groupName: 'Cut (C00)',
    })
    expect(result.widthMm).toBeCloseTo(20)
    expect(result.heightMm).toBeCloseTo(10)
  })

  it('converts legacy LBRN and DXF through the regular import pipeline', () => {
    const legacy = parseLbrnImport(
      `<LightBurnProject><Shape Type="Path"><V vx="0" vy="0"/><V vx="10" vy="0"/><V vx="10" vy="10"/><V vx="0" vy="10"/><P T="L" p0="0" p1="1"/><P T="L" p0="1" p1="2"/><P T="L" p0="2" p1="3"/><P T="L" p0="3" p1="0"/></Shape></LightBurnProject>`,
      'legacy.lbrn',
    )
    expect(legacy).toMatchObject({
      fileName: 'legacy.lbrn',
      sourceFormat: 'lbrn',
      hasReliableSize: true,
    })
    expect(legacy.objects).toHaveLength(1)

    const converted = parseDxfImport(
      `0
SECTION
2
HEADER
9
$INSUNITS
70
4
0
ENDSEC
0
SECTION
2
ENTITIES
0
LWPOLYLINE
8
Cut
70
1
10
0
20
0
10
20
20
0
10
20
20
10
10
0
20
10
0
ENDSEC
0
EOF`,
      'part.dxf',
    )
    expect(converted).toMatchObject({
      fileName: 'part.dxf',
      sourceFormat: 'dxf',
      hasReliableSize: true,
    })
    expect(converted.convertedSvg).toContain('<svg')
    expect(converted.objects).toHaveLength(1)
    expect(converted.widthMm).toBeCloseTo(20)
  })

  it('keeps every cut part, attaches engraving operations and estimates finger thickness', () => {
    const result = parseLbrn2Import(`
      <LightBurnProject>
        <CutSetting type="Cut"><index Value="0"/><name Value="Outer Cut"/></CutSetting>
        <CutSetting type="Cut"><index Value="2"/><name Value="Stock"/></CutSetting>
        <CutSetting type="Scan"><index Value="14"/><name Value="Engrave"/></CutSetting>
        <Shape Type="Rect" CutIndex="2" W="200" H="200"><XForm>1 0 0 1 0 0</XForm></Shape>
        <Shape Type="Path" CutIndex="0"><XForm>1 0 0 1 -40 0</XForm>
          <VertList>V0 0V30 0V30 30V27 30V27 25V30 25V30 20V27 20V27 15V30 15V30 10V27 10V27 5V30 5V30 0</VertList>
          <PrimList>LineClosed</PrimList>
        </Shape>
        <Shape Type="Rect" CutIndex="0" W="20" H="20"><XForm>1 0 0 1 0 0</XForm></Shape>
        <Shape Type="Rect" CutIndex="0" W="20" H="20"><XForm>1 0 0 1 40 0</XForm></Shape>
        <Shape Type="Text" CutIndex="14" Str="Linke Seite"><BackupPath Type="Path" CutIndex="14"><XForm>1 0 0 1 -35 5</XForm><VertList>V0 0V2 0V2 2V0 2</VertList><PrimList>LineClosed</PrimList></BackupPath></Shape>
        <Shape Type="Rect" CutIndex="14" W="5" H="5"><XForm>1 0 0 1 0 0</XForm></Shape>
      </LightBurnProject>`)
    expect(result.estimatedThickness).toMatchObject({
      mm: 3,
      confidence: 'mittel',
    })
    expect(
      result.objects.filter((object) => object.recommendedInclude),
    ).toHaveLength(4)
    expect(
      result.objects.find((object) => object.sourceLayer === 'Stock')
        ?.recommendedInclude,
    ).toBe(true)
    expect(
      result.objects
        .filter((object) => object.sourceOperation === 'Scan')
        .every((object) => object.recommendedInclude === false),
    ).toBe(true)
    expect(
      result.objects
        .flatMap((object) => object.attachedOperations ?? [])
        .some(
          (operation) =>
            operation.shapeType === 'Text' && operation.name === 'Linke Seite',
        ),
    ).toBe(true)
    expect(
      result.warnings.some((warning) => /Arbeitsfläche/.test(warning.message)),
    ).toBe(false)
  })
})
