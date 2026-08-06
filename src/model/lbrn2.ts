import type { ProjectExportStep } from './export'

type Point = [number, number]
type Matrix = [number, number, number, number, number, number]
type Vertex = { point: Point; left: Point; right: Point }
type Primitive = { type: 'L' | 'B'; start: number; end: number }

export type Lbrn2CutSetting = {
  index: number
  name: string
  type: string
  speed: number
  minPower: number
  maxPower: number
  passes: number
  interval?: number
}

export type Lbrn2Conversion = {
  svg: string
  appVersion: string
  deviceName: string
  cutSettings: Lbrn2CutSetting[]
  shapeCount: number
  warnings: string[]
}

const lightBurnColors = [
  '#000000',
  '#0000ff',
  '#ff0000',
  '#00b000',
  '#c0a000',
  '#00a0a0',
  '#d000d0',
  '#707070',
  '#7f0000',
  '#007f00',
  '#00007f',
  '#7f7f00',
  '#007f7f',
  '#7f007f',
  '#ff7f00',
  '#7f7f7f',
  '#ff7f7f',
  '#7f7fff',
  '#7fff7f',
  '#ff7fff',
  '#7fffff',
  '#b06020',
  '#6040a0',
  '#2090c0',
  '#c04070',
  '#608020',
  '#205080',
  '#a05020',
  '#406060',
  '#804060',
]

const identity: Matrix = [1, 0, 0, 1, 0, 0]
const multiply = (parent: Matrix, local: Matrix): Matrix => [
  parent[0] * local[0] + parent[2] * local[1],
  parent[1] * local[0] + parent[3] * local[1],
  parent[0] * local[2] + parent[2] * local[3],
  parent[1] * local[2] + parent[3] * local[3],
  parent[0] * local[4] + parent[2] * local[5] + parent[4],
  parent[1] * local[4] + parent[3] * local[5] + parent[5],
]
const transform = ([a, b, c, d, e, f]: Matrix, [x, y]: Point): Point => [
  a * x + c * y + e,
  b * x + d * y + f,
]
const matrixOf = (element: Element): Matrix => {
  const values = (element.querySelector(':scope > XForm')?.textContent ?? '')
    .trim()
    .split(/\s+/)
    .map(Number)
  return values.length === 6 && values.every(Number.isFinite)
    ? (values as Matrix)
    : identity
}
const xmlEscape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
      })[char]!,
  )
const number = (value: number) => Number(value.toFixed(5))
const childValue = (element: Element, name: string, fallback = 0) => {
  const value = Number(
    element.querySelector(`:scope > ${name}`)?.getAttribute('Value'),
  )
  return Number.isFinite(value) ? value : fallback
}

function parseVertices(value: string): Vertex[] {
  return [...value.matchAll(/V([^V]+)/g)].flatMap((match): Vertex[] => {
    const coordinates = match[1].match(
      /^\s*(-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?)\s+(-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?)/i,
    )
    if (!coordinates) return []
    const point: Point = [Number(coordinates[1]), Number(coordinates[2])]
    const control = (name: string, fallback: number) => {
      const found = new RegExp(
        `${name}(-?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[-+]?\\d+)?)`,
        'i',
      ).exec(match[1])
      if (!found || found[1] === '1') return fallback
      const parsed = Number(found[1])
      return Number.isFinite(parsed) ? parsed : fallback
    }
    return [
      {
        point,
        left: [control('c0x', point[0]), control('c0y', point[1])],
        right: [control('c1x', point[0]), control('c1y', point[1])],
      },
    ]
  })
}

function parseLegacyVertices(shape: Element): Vertex[] {
  const coordinate = (vertex: Element, name: string, fallback: number) => {
    const parsed = Number(vertex.getAttribute(name))
    return Number.isFinite(parsed) ? parsed : fallback
  }
  return [...shape.querySelectorAll(':scope > V')].flatMap((vertex) => {
    const x = Number(vertex.getAttribute('vx'))
    const y = Number(vertex.getAttribute('vy'))
    if (!Number.isFinite(x) || !Number.isFinite(y)) return []
    return [
      {
        point: [x, y] as Point,
        left: [
          coordinate(vertex, 'c0x', x),
          coordinate(vertex, 'c0y', y),
        ] as Point,
        right: [
          coordinate(vertex, 'c1x', x),
          coordinate(vertex, 'c1y', y),
        ] as Point,
      },
    ]
  })
}

function parsePrimitives(value: string, vertices: Vertex[]): Primitive[] {
  const explicit = [...value.matchAll(/([LB])(\d+)\s+(\d+)/g)].map((match) => ({
    type: match[1] as 'L' | 'B',
    start: Number(match[2]),
    end: Number(match[3]),
  }))
  if (explicit.length) return explicit
  if (vertices.length < 2) return []
  return vertices.map((vertex, index): Primitive => {
    const end = (index + 1) % vertices.length
    const target = vertices[end]
    const curved =
      vertex.right[0] !== vertex.point[0] ||
      vertex.right[1] !== vertex.point[1] ||
      target.left[0] !== target.point[0] ||
      target.left[1] !== target.point[1]
    return { type: curved ? 'B' : 'L', start: index, end }
  })
}

function parseLegacyPrimitives(shape: Element): Primitive[] {
  return [...shape.querySelectorAll(':scope > P')].flatMap((primitive) => {
    const type = primitive.getAttribute('T')?.toUpperCase()
    const start = Number(primitive.getAttribute('p0'))
    const end = Number(primitive.getAttribute('p1'))
    return (type === 'L' || type === 'B') &&
      Number.isInteger(start) &&
      Number.isInteger(end)
      ? [{ type, start, end }]
      : []
  })
}

function pathData(vertices: Vertex[], primitives: Primitive[], matrix: Matrix) {
  let data = ''
  let previousEnd = -1
  let componentStart = -1
  const points: Point[] = []
  for (const primitive of primitives) {
    const start = vertices[primitive.start]
    const end = vertices[primitive.end]
    if (!start || !end) continue
    const startPoint = transform(matrix, start.point)
    const endPoint = transform(matrix, end.point)
    if (previousEnd !== primitive.start) {
      data += ` M ${number(startPoint[0])} ${number(startPoint[1])}`
      componentStart = primitive.start
      points.push(startPoint)
    }
    if (primitive.type === 'B') {
      const first = transform(matrix, start.right)
      const second = transform(matrix, end.left)
      data += ` C ${number(first[0])} ${number(first[1])} ${number(second[0])} ${number(second[1])} ${number(endPoint[0])} ${number(endPoint[1])}`
      points.push(first, second, endPoint)
    } else {
      data += ` L ${number(endPoint[0])} ${number(endPoint[1])}`
      points.push(endPoint)
    }
    if (primitive.end === componentStart) data += ' Z'
    previousEnd = primitive.end
  }
  return { data: data.trim(), points }
}

export function convertLbrn2ToSvg(contents: string): Lbrn2Conversion {
  if (typeof DOMParser === 'undefined')
    throw new Error(
      'LightBurn-Dateien können in dieser Umgebung nicht gelesen werden.',
    )
  const xml = new DOMParser().parseFromString(contents, 'application/xml')
  if (xml.querySelector('parsererror'))
    throw new Error(
      'Die LightBurn-Datei ist beschädigt oder nicht vollständig.',
    )
  const root = xml.documentElement
  if (root.tagName !== 'LightBurnProject')
    throw new Error('Die ausgewählte Datei ist kein LightBurn-Projekt.')

  const cutSettings = [...root.querySelectorAll(':scope > CutSetting')].map(
    (setting): Lbrn2CutSetting => ({
      index: childValue(setting, 'index', -1),
      name:
        setting.querySelector(':scope > name')?.getAttribute('Value') ??
        'Layer',
      type: setting.getAttribute('type') ?? 'Cut',
      speed: childValue(setting, 'speed'),
      minPower: childValue(setting, 'minPower'),
      maxPower: childValue(setting, 'maxPower'),
      passes: childValue(setting, 'numPasses', 1),
      interval: childValue(setting, 'interval') || undefined,
    }),
  )
  const cutByIndex = new Map(
    cutSettings.map((setting) => [setting.index, setting]),
  )
  const warnings = new Set<string>()
  const output: string[] = []
  const bounds: Point[] = []
  let shapeCount = 0
  const shapeAttributes = (
    index: number,
    shapeType: string,
    label?: string,
  ) => {
    const setting = cutByIndex.get(index)
    return `data-cut-index="${index}" data-layer="${xmlEscape(setting?.name ?? `C${index.toString().padStart(2, '0')}`)}" data-operation="${xmlEscape(setting?.type ?? 'Cut')}" data-shape-type="${xmlEscape(shapeType)}"${label ? ` aria-label="${xmlEscape(label)}"` : ''}`
  }

  const addPath = (
    shape: Element,
    matrix: Matrix,
    label?: string,
    shapeType = 'Path',
  ) => {
    const compactVertices = shape.querySelector(':scope > VertList')
    const vertices = compactVertices
      ? parseVertices(compactVertices.textContent ?? '')
      : parseLegacyVertices(shape)
    const compactPrimitives = shape.querySelector(':scope > PrimList')
    const legacyPrimitives = parseLegacyPrimitives(shape)
    const primitives = compactPrimitives
      ? parsePrimitives(compactPrimitives.textContent ?? '', vertices)
      : legacyPrimitives.length
        ? legacyPrimitives
        : parsePrimitives('', vertices)
    const path = pathData(vertices, primitives, matrix)
    if (!path.data) return
    const index = Number(shape.getAttribute('CutIndex') ?? 0)
    const color = lightBurnColors[index] ?? '#000000'
    output.push(
      `<path d="${path.data}" fill="${color}" fill-rule="evenodd" stroke="${color}" stroke-width="0.1" ${shapeAttributes(index, shapeType, label)}/>`,
    )
    bounds.push(...path.points)
    shapeCount++
  }

  const visit = (shape: Element, parent: Matrix) => {
    const matrix = multiply(parent, matrixOf(shape))
    const type = shape.getAttribute('Type') ?? shape.getAttribute('type') ?? ''
    const label =
      shape.getAttribute('Str') ?? shape.getAttribute('Name') ?? undefined
    if (type === 'Path') addPath(shape, matrix, label)
    else if (type === 'Rect') {
      const width = Number(shape.getAttribute('W')) || 0
      const height = Number(shape.getAttribute('H')) || 0
      const radius = Math.max(0, Number(shape.getAttribute('Cr')) || 0)
      const vertices: Vertex[] = [
        [-width / 2, -height / 2],
        [width / 2, -height / 2],
        [width / 2, height / 2],
        [-width / 2, height / 2],
      ].map((point) => ({
        point: point as Point,
        left: point as Point,
        right: point as Point,
      }))
      const path = pathData(vertices, parsePrimitives('', vertices), matrix)
      const index = Number(shape.getAttribute('CutIndex') ?? 0)
      const color = lightBurnColors[index] ?? '#000000'
      output.push(
        `<path d="${path.data}" fill="${color}" fill-rule="evenodd" stroke="${color}" stroke-width="0.1" ${shapeAttributes(index, 'Rect', label)}${radius ? ` data-corner-radius="${radius}"` : ''}/>`,
      )
      bounds.push(...path.points)
      shapeCount++
    } else if (type === 'Ellipse') {
      const rx = Number(shape.getAttribute('Rx')) || 0
      const ry = Number(shape.getAttribute('Ry')) || 0
      const center = transform(matrix, [0, 0])
      const xAxis = transform(matrix, [rx, 0])
      const yAxis = transform(matrix, [0, ry])
      const actualRx = Math.hypot(xAxis[0] - center[0], xAxis[1] - center[1])
      const actualRy = Math.hypot(yAxis[0] - center[0], yAxis[1] - center[1])
      const angle =
        (Math.atan2(xAxis[1] - center[1], xAxis[0] - center[0]) * 180) / Math.PI
      const index = Number(shape.getAttribute('CutIndex') ?? 0)
      const color = lightBurnColors[index] ?? '#000000'
      output.push(
        `<ellipse cx="${number(center[0])}" cy="${number(center[1])}" rx="${number(actualRx)}" ry="${number(actualRy)}" transform="rotate(${number(angle)} ${number(center[0])} ${number(center[1])})" fill="${color}" stroke="${color}" stroke-width="0.1" ${shapeAttributes(index, 'Ellipse', label)}/>`,
      )
      bounds.push(
        [center[0] - actualRx, center[1] - actualRy],
        [center[0] + actualRx, center[1] + actualRy],
      )
      shapeCount++
    } else if (type === 'Text') {
      const backup = shape.querySelector(':scope > BackupPath')
      if (backup)
        addPath(backup, multiply(parent, matrixOf(backup)), label, 'Text')
      else
        warnings.add(
          `Text „${label ?? 'ohne Namen'}“ besitzt keinen Vektorpfad und wurde ausgelassen.`,
        )
    } else if (type !== 'Group')
      warnings.add(
        `Shape-Typ „${type || 'unbekannt'}“ wird noch nicht unterstützt.`,
      )
    shape
      .querySelectorAll(':scope > Children > Shape')
      .forEach((child) => visit(child, matrix))
  }
  root
    .querySelectorAll(':scope > Shape')
    .forEach((shape) => visit(shape, identity))
  if (!shapeCount)
    throw new Error(
      'Die LightBurn-Datei enthält keine unterstützte Vektorgeometrie.',
    )
  const minX = Math.min(...bounds.map(([x]) => x))
  const minY = Math.min(...bounds.map(([, y]) => y))
  const maxX = Math.max(...bounds.map(([x]) => x))
  const maxY = Math.max(...bounds.map(([, y]) => y))
  const width = Math.max(0.1, maxX - minX)
  const height = Math.max(0.1, maxY - minY)
  const source = root.querySelector('Shape > V, BackupPath > V')
    ? 'lbrn'
    : 'lbrn2'
  const svg = `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="${number(width)}mm" height="${number(height)}mm" viewBox="${number(minX)} ${number(minY)} ${number(width)} ${number(height)}"><metadata>${xmlEscape(JSON.stringify({ source, appVersion: root.getAttribute('AppVersion'), deviceName: root.getAttribute('DeviceName'), cutSettings }))}</metadata>${output.join('')}</svg>`
  return {
    svg,
    appVersion: root.getAttribute('AppVersion') ?? '',
    deviceName: root.getAttribute('DeviceName') ?? '',
    cutSettings,
    shapeCount,
    warnings: [...warnings],
  }
}

export const convertLbrnToSvg = convertLbrn2ToSvg

const vertexList = (loop: Point[]) =>
  loop.map(([x, y]) => `V${number(x)} ${number(y)}c0x1c1x1`).join('')
const primitiveList = (count: number) =>
  Array.from(
    { length: count },
    (_, index) => `L${index} ${(index + 1) % count}`,
  ).join('')

export type Lbrn2ExportShape = { loop: Point[]; cutIndex: number }

export function createLbrn2Project(
  shapes: Lbrn2ExportShape[],
  steps: ProjectExportStep[],
  deviceName: string,
) {
  const settings = steps
    .map(
      (
        step,
        index,
      ) => `  <CutSetting type="${step.mode === 'fill' ? 'Scan' : 'Cut'}">
    <index Value="${index}"/><name Value="${xmlEscape(step.name)}"/>
    <minPower Value="${number(step.power)}"/><maxPower Value="${number(step.power)}"/>
    <speed Value="${number(step.speed)}"/><numPasses Value="${Math.max(1, step.passes)}"/>
    <interval Value="${number(step.lineInterval ?? 0.1)}"/><priority Value="${index}"/>
  </CutSetting>`,
    )
    .join('\n')
  const geometry = shapes
    .map(
      (shape) => `  <Shape Type="Path" CutIndex="${shape.cutIndex}">
    <XForm>1 0 0 1 0 0</XForm>
    <VertList>${vertexList(shape.loop)}</VertList>
    <PrimList>${primitiveList(shape.loop.length)}</PrimList>
  </Shape>`,
    )
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<LightBurnProject AppVersion="1.7.07" DeviceName="${xmlEscape(deviceName)}" FormatVersion="1" MaterialHeight="0" MirrorX="False" MirrorY="False">
${settings}
${geometry}
</LightBurnProject>`
}
