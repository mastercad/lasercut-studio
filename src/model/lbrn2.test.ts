import { describe, expect, it, vi } from 'vitest'
import {
  createLbrn2Project,
  convertLbrn2ToSvg,
  convertLbrnToSvg,
} from './lbrn2'
import type { ProjectExportStep } from './export'

const project = (body: string) => `<?xml version="1.0"?>
<LightBurnProject AppVersion="1.7.07" DeviceName="GRBL" FormatVersion="1" MirrorX="False" MirrorY="False">
  <CutSetting type="Cut"><index Value="2"/><name Value="Schnitt &amp; Test"/><minPower Value="10"/><maxPower Value="80"/><speed Value="400"/><numPasses Value="2"/></CutSetting>
  ${body}
</LightBurnProject>`

describe('LBRN2 conversion', () => {
  it('converts legacy LBRN vertices, primitives and bezier controls', () => {
    const result = convertLbrnToSvg(
      project(`<Shape Type="Path" CutIndex="2"><XForm>1 0 0 1 10 20</XForm>
        <V vx="0" vy="0" c1x="2" c1y="0"/><V vx="5" vy="0" c0x="3" c0y="0"/>
        <V vx="5" vy="5"/><V vx="0" vy="5"/>
        <P T="B" p0="0" p1="1"/><P T="L" p0="1" p1="2"/>
        <P T="L" p0="2" p1="3"/><P T="L" p0="3" p1="0"/>
      </Shape>`),
    )
    expect(result.shapeCount).toBe(1)
    expect(result.svg).toContain('M 10 20 C 12 20 13 20 15 20')
    expect(result.svg).toContain('&quot;source&quot;:&quot;lbrn&quot;')
  })
  it('converts transformed line and bezier primitives with cut settings', () => {
    const result = convertLbrn2ToSvg(
      project(`<Shape Type="Group"><XForm>1 0 0 1 10 20</XForm><Children>
        <Shape Type="Path" CutIndex="2"><XForm>2 0 0 2 0 0</XForm>
          <VertList>V0 0c0x1c1x1V5 0c0x1c1x3c1y-2V5 5c0x1c1x1</VertList>
          <PrimList>L0 1B1 2L2 0</PrimList>
        </Shape>
      </Children></Shape>`),
    )
    expect(result).toMatchObject({
      appVersion: '1.7.07',
      deviceName: 'GRBL',
      shapeCount: 1,
      cutSettings: [
        expect.objectContaining({
          index: 2,
          name: 'Schnitt & Test',
          speed: 400,
          maxPower: 80,
          passes: 2,
        }),
      ],
    })
    expect(result.svg).toContain('M 10 20 L 20 20 C 16 16 20 30 20 30')
    expect(result.svg).toContain('data-cut-index="2"')
    expect(result.svg).toContain('data-layer="Schnitt &amp; Test"')
    expect(result.svg).toContain('fill="#ff0000"')
  })

  it('supports rectangles, ellipses and text backup paths and reports unknown shapes', () => {
    const result = convertLbrn2ToSvg(
      project(`
        <Shape Type="Rect" CutIndex="2" W="20" H="10" Cr="2"><XForm>1 0 0 1 20 20</XForm></Shape>
        <Shape Type="Ellipse" CutIndex="2" Rx="5" Ry="3"><XForm>1 0 0 1 50 20</XForm></Shape>
        <Shape Type="Text" CutIndex="2" Str="Hallo" HasBackupPath="1">
          <BackupPath Type="Path" CutIndex="2"><XForm>1 0 0 1 70 20</XForm><VertList>V0 0c0x1c1x1V5 0c0x1c1x1V5 5c0x1c1x1V0 5c0x1c1x1</VertList></BackupPath>
        </Shape>
        <Shape Type="Image" CutIndex="2"><XForm>1 0 0 1 0 0</XForm></Shape>
      `),
    )
    expect(result.shapeCount).toBe(3)
    expect(result.svg).toContain('<ellipse')
    expect(result.svg).toContain('data-corner-radius="2"')
    expect(result.svg).toContain('aria-label="Hallo"')
    expect(result.warnings).toContain(
      'Shape-Typ „Image“ wird noch nicht unterstützt.',
    )
  })

  it('rejects malformed and geometry-free documents', () => {
    expect(() => convertLbrn2ToSvg('<broken>')).toThrow('beschädigt')
    expect(() => convertLbrn2ToSvg('<svg/>')).toThrow('kein LightBurn-Projekt')
    expect(() => convertLbrn2ToSvg(project(''))).toThrow(
      'keine unterstützte Vektorgeometrie',
    )
  })

  it('uses safe fallbacks for incomplete projects and reports text without outlines', () => {
    const result = convertLbrn2ToSvg(`
      <LightBurnProject>
        <CutSetting><index Value="invalid"/><speed Value="invalid"/></CutSetting>
        <Shape Type="Path" CutIndex="99" Name="Fallback"><XForm>invalid</XForm>
          <VertList>VinvalidV0 0V10 0V10 10V0 10</VertList>
          <PrimList>L99 0</PrimList>
        </Shape>
        <Shape Type="Path"><VertList>V0 0c0x1c1x1V2 0c0x1c1x1V2 2c0x1c1x1V0 2c0x1c1x1</VertList></Shape>
        <Shape Type="Rect" CutIndex="99" W="10" H="10"><XForm>1 0 0 1 5 5</XForm></Shape>
        <Shape Type="Ellipse" CutIndex="99"/>
        <Shape Type="Text"/>
        <Shape/>
      </LightBurnProject>`)
    expect(result.cutSettings[0]).toMatchObject({
      index: -1,
      name: 'Layer',
      type: 'Cut',
      speed: 0,
      passes: 1,
    })
    expect(result.svg).toContain('fill="#000000"')
    expect(result.svg).toContain('data-layer="C00"')
    expect(result.warnings).toEqual([
      'Text „ohne Namen“ besitzt keinen Vektorpfad und wurde ausgelassen.',
      'Shape-Typ „unbekannt“ wird noch nicht unterstützt.',
    ])
  })

  it('reports when no browser XML parser is available', () => {
    const parser = globalThis.DOMParser
    vi.stubGlobal('DOMParser', undefined)
    expect(() => convertLbrn2ToSvg(project(''))).toThrow('dieser Umgebung')
    vi.stubGlobal('DOMParser', parser)
  })

  it('serializes a loadable project with settings and closed paths', () => {
    const step: ProjectExportStep = {
      id: 'outer',
      materialId: 'mdf',
      name: 'Außenschnitt',
      kind: 'cut-outer',
      color: '#ff0000',
      mode: 'line',
      speed: 400,
      power: 80,
      minPower: 10,
      passes: 2,
      airAssist: true,
      objectIds: ['panel'],
      contourCount: 1,
      configured: true,
      output: false,
      sourceParameters: {
        frequency: 40_000,
        overscanPercent: 5,
        angle: 45,
      },
    }
    const output = createLbrn2Project(
      [
        {
          cutIndex: 0,
          loop: [
            [0, 0],
            [20, 0],
            [20, 10],
            [0, 10],
          ],
        },
      ],
      [step],
      'Testlaser',
    )
    expect(output).toContain('<CutSetting type="Cut">')
    expect(output).toContain('<speed Value="400"/>')
    expect(output).toContain('<minPower Value="10"/>')
    expect(output).toContain('<airAssist Value="1"/>')
    expect(output).toContain('<output Value="0"/>')
    expect(output).toContain('<frequency Value="40000"/>')
    expect(output).toContain('<PrimList>L0 1L1 2L2 3L3 0</PrimList>')
    const roundTrip = convertLbrn2ToSvg(output)
    expect(roundTrip.shapeCount).toBe(1)
    expect(roundTrip.cutSettings[0]).toMatchObject({
      name: 'Außenschnitt',
      speed: 400,
      maxPower: 80,
      minPower: 10,
      passes: 2,
      airAssist: true,
      output: false,
      frequency: 40_000,
    })
  })

  it('serializes scan settings with clamped passes and escaped names', () => {
    const step = {
      id: 'scan',
      materialId: 'mdf',
      name: 'Scan <fine>',
      kind: 'profile',
      color: '#000000',
      mode: 'fill',
      speed: 100,
      power: 20,
      passes: 0,
      airAssist: false,
      objectIds: [],
      contourCount: 0,
      configured: true,
      lineInterval: 0.08,
    } satisfies ProjectExportStep
    const output = createLbrn2Project([], [step], 'Laser & Test')
    expect(output).toContain('<CutSetting type="Scan">')
    expect(output).toContain('name Value="Scan &lt;fine&gt;"')
    expect(output).toContain('numPasses Value="1"')
    expect(output).toContain('interval Value="0.08"')
    expect(output).toContain('DeviceName="Laser &amp; Test"')
  })
})
