// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { convertDxfToSvg } from './dxfImport'

const dxf = (entities: string, units = 4, tables = '') => `0
SECTION
2
HEADER
9
$INSUNITS
70
${units}
0
ENDSEC
${tables}0
SECTION
2
ENTITIES
${entities}0
ENDSEC
0
EOF`

describe('DXF conversion', () => {
  it('converts closed lightweight polylines with units, bulges and layer colors', () => {
    const result = convertDxfToSvg(
      dxf(
        `0
LWPOLYLINE
8
Cut
90
4
70
1
10
0
20
0
42
1
10
10
20
0
10
10
20
10
10
0
20
10
`,
        1,
        `0
SECTION
2
TABLES
0
LAYER
2
Cut
420
3368601
0
ENDSEC
`,
      ),
    )
    expect(result).toMatchObject({
      entityCount: 1,
      units: 'Zoll',
      hasReliableSize: true,
    })
    expect(result.svg).toContain('width="254mm"')
    expect(result.svg).toContain('fill="#336699"')
    expect(result.svg).toContain('aria-label="Cut"')
    expect(result.svg.match(/ L /g)?.length).toBeGreaterThan(10)
  })

  it('supports legacy polylines, joined lines, circles and ellipses', () => {
    const result = convertDxfToSvg(
      dxf(`0
POLYLINE
8
Legacy
70
1
0
VERTEX
10
0
20
0
0
VERTEX
10
5
20
0
0
VERTEX
10
0
20
5
0
SEQEND
0
LINE
8
Lines
10
10
20
0
11
15
21
0
0
LINE
8
Lines
10
15
20
5
11
15
21
0
0
LINE
8
Lines
10
10
20
5
11
15
21
5
0
LINE
8
Lines
10
10
20
0
11
10
21
5
0
CIRCLE
8
Round
10
25
20
5
40
5
0
ELLIPSE
8
Oval
10
40
20
5
11
5
21
0
40
0.5
`),
    )
    expect(result.entityCount).toBe(7)
    expect(result.svg).toContain('aria-label="Legacy"')
    expect(result.svg).toContain('aria-label="Lines"')
    expect(result.svg).toContain('aria-label="Round"')
    expect(result.svg).toContain('aria-label="Oval"')
    expect(result.warnings).toEqual([])
  })

  it('marks unknown units and reports open or unsupported entities', () => {
    const result = convertDxfToSvg(
      dxf(
        `0
LINE
8
Open
10
0
20
0
11
10
21
0
0
ARC
10
0
20
0
40
5
`,
        0,
      ),
    )
    expect(result.hasReliableSize).toBe(false)
    expect(result.units).toBe('Unbekannt')
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('ARC'),
        expect.stringContaining('Offene Kontur'),
      ]),
    )
  })

  it('rejects malformed and geometry-free documents', () => {
    expect(() => convertDxfToSvg('not a dxf')).toThrow('beschädigt')
    expect(() => convertDxfToSvg(dxf(''))).toThrow(
      'keine unterstützte Vektorgeometrie',
    )
  })
})
