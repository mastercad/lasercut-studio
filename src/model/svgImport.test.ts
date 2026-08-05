// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { parseSvgImport } from './svgImport'

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
})
