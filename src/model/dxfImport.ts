type Point = [number, number]
type Group = { code: number; value: string }
type Entity = { type: string; groups: Group[] }

export type DxfConversion = {
  svg: string
  entityCount: number
  units: string
  hasReliableSize: boolean
  warnings: string[]
}

const aci = [
  '#000000',
  '#ff0000',
  '#ffff00',
  '#00ff00',
  '#00ffff',
  '#0000ff',
  '#ff00ff',
  '#ffffff',
  '#808080',
  '#c0c0c0',
]
const unitFactors: Record<number, [string, number]> = {
  1: ['Zoll', 25.4],
  2: ['Fuß', 304.8],
  4: ['Millimeter', 1],
  5: ['Zentimeter', 10],
  6: ['Meter', 1000],
  9: ['Mil', 0.0254],
}
const number = (value: number) => Number(value.toFixed(6))
const escapeXml = (value: string) =>
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
const valueOf = (entity: Entity, code: number, fallback = '') =>
  entity.groups.find((group) => group.code === code)?.value ?? fallback
const valuesOf = (entity: Entity, code: number) =>
  entity.groups
    .filter((group) => group.code === code)
    .map((group) => group.value)
const numeric = (entity: Entity, code: number, fallback = 0) => {
  const raw = valueOf(entity, code)
  if (raw === '') return fallback
  const value = Number(raw)
  return Number.isFinite(value) ? value : fallback
}
const colorOf = (entity: Entity, layers: Map<string, string>) => {
  const trueColor = numeric(entity, 420, -1)
  if (trueColor >= 0)
    return `#${trueColor.toString(16).padStart(6, '0').slice(-6)}`
  const index = Math.abs(numeric(entity, 62, 256))
  return index !== 256
    ? (aci[index] ?? '#000000')
    : (layers.get(valueOf(entity, 8, '0')) ?? '#000000')
}

function parseGroups(contents: string): Group[] {
  const lines = contents.replace(/^\uFEFF/, '').split(/\r?\n/)
  const groups: Group[] = []
  for (let index = 0; index + 1 < lines.length; index += 2) {
    const code = Number(lines[index].trim())
    if (Number.isInteger(code))
      groups.push({ code, value: lines[index + 1].trim() })
  }
  return groups
}

function records(groups: Group[]) {
  const result: Entity[] = []
  let current: Entity | null = null
  for (const group of groups) {
    if (group.code === 0) {
      if (current) result.push(current)
      current = { type: group.value.toUpperCase(), groups: [] }
    } else current?.groups.push(group)
  }
  if (current) result.push(current)
  return result
}

const pointKey = ([x, y]: Point) =>
  `${Math.round(x * 10000)},${Math.round(y * 10000)}`
const samePoint = (first: Point, second: Point) =>
  pointKey(first) === pointKey(second)

function bulgePoints(start: Point, end: Point, bulge: number): Point[] {
  if (Math.abs(bulge) < 1e-9) return [end]
  const dx = end[0] - start[0],
    dy = end[1] - start[1]
  const chord = Math.hypot(dx, dy)
  if (!chord) return [end]
  const centerDistance = (chord * (1 - bulge * bulge)) / (4 * bulge)
  const middle: Point = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2]
  const center: Point = [
    middle[0] - (dy / chord) * centerDistance,
    middle[1] + (dx / chord) * centerDistance,
  ]
  const startAngle = Math.atan2(start[1] - center[1], start[0] - center[0])
  const sweep = 4 * Math.atan(bulge)
  const segments = Math.max(4, Math.ceil(Math.abs(sweep) / (Math.PI / 18)))
  const radius = Math.hypot(start[0] - center[0], start[1] - center[1])
  return Array.from({ length: segments }, (_, index): Point => {
    const angle = startAngle + (sweep * (index + 1)) / segments
    return [
      center[0] + Math.cos(angle) * radius,
      center[1] + Math.sin(angle) * radius,
    ]
  })
}

function polylinePoints(entity: Entity): { points: Point[]; closed: boolean } {
  const xs = valuesOf(entity, 10).map(Number)
  const ys = valuesOf(entity, 20).map(Number)
  const bulges = valuesOf(entity, 42).map(Number)
  const vertices = xs.flatMap((x, index): Point[] =>
    Number.isFinite(x) && Number.isFinite(ys[index]) ? [[x, ys[index]]] : [],
  )
  const closed = (numeric(entity, 70) & 1) === 1
  const points: Point[] = vertices.length ? [vertices[0]] : []
  const edgeCount = closed ? vertices.length : Math.max(0, vertices.length - 1)
  for (let index = 0; index < edgeCount; index++)
    points.push(
      ...bulgePoints(
        vertices[index],
        vertices[(index + 1) % vertices.length],
        bulges[index] || 0,
      ),
    )
  return { points, closed }
}

function chainLines(
  lines: Array<{ start: Point; end: Point; layer: string; color: string }>,
) {
  const remaining = [...lines]
  const chains: Array<{
    points: Point[]
    layer: string
    color: string
    closed: boolean
  }> = []
  while (remaining.length) {
    const first = remaining.shift()!
    const points = [first.start, first.end]
    for (let guard = 0; guard < lines.length + 1; guard++) {
      const end = points.at(-1)!
      const index = remaining.findIndex(
        (line) =>
          line.layer === first.layer &&
          (samePoint(line.start, end) || samePoint(line.end, end)),
      )
      if (index < 0) break
      const next = remaining.splice(index, 1)[0]
      points.push(samePoint(next.start, end) ? next.end : next.start)
      if (samePoint(points[0], points.at(-1)!)) break
    }
    chains.push({
      points,
      layer: first.layer,
      color: first.color,
      closed: samePoint(points[0], points.at(-1)!),
    })
  }
  return chains
}

export function convertDxfToSvg(contents: string): DxfConversion {
  const groups = parseGroups(contents)
  if (
    !groups.some(
      (group) => group.code === 0 && group.value.toUpperCase() === 'SECTION',
    )
  )
    throw new Error(
      'Die DXF-Datei ist beschädigt oder kein unterstütztes ASCII-DXF.',
    )
  const allRecords = records(groups)
  const layers = new Map<string, string>()
  for (const record of allRecords.filter((record) => record.type === 'LAYER')) {
    const color = numeric(record, 420, -1)
    const index = Math.abs(numeric(record, 62, 7))
    layers.set(
      valueOf(record, 2, '0'),
      color >= 0
        ? `#${color.toString(16).padStart(6, '0').slice(-6)}`
        : (aci[index] ?? '#000000'),
    )
  }
  let inEntities = false
  const entities: Entity[] = []
  for (const record of allRecords) {
    if (
      record.type === 'SECTION' &&
      valueOf(record, 2).toUpperCase() === 'ENTITIES'
    )
      inEntities = true
    else if (record.type === 'ENDSEC') inEntities = false
    else if (inEntities) entities.push(record)
  }
  const unitIndex = (() => {
    const index = groups.findIndex(
      (group) => group.code === 9 && group.value === '$INSUNITS',
    )
    return index >= 0
      ? Number(
          groups.slice(index + 1).find((group) => group.code === 70)?.value,
        )
      : 0
  })()
  const [units, factor] = unitFactors[unitIndex] ?? ['Unbekannt', 1]
  const warnings = new Set<string>()
  const paths: Array<{
    points: Point[]
    closed: boolean
    layer: string
    color: string
  }> = []
  const lines: Array<{
    start: Point
    end: Point
    layer: string
    color: string
  }> = []
  let pendingPolyline: {
    layer: string
    color: string
    closed: boolean
    points: Point[]
  } | null = null
  let entityCount = 0
  for (const entity of entities) {
    const layer = valueOf(entity, 8, '0')
    const color = colorOf(entity, layers)
    if (entity.type === 'LWPOLYLINE') {
      const polyline = polylinePoints(entity)
      paths.push({ ...polyline, layer, color })
      entityCount++
    } else if (entity.type === 'POLYLINE') {
      pendingPolyline = {
        layer,
        color,
        closed: (numeric(entity, 70) & 1) === 1,
        points: [],
      }
      entityCount++
    } else if (entity.type === 'VERTEX' && pendingPolyline) {
      pendingPolyline.points.push([numeric(entity, 10), numeric(entity, 20)])
    } else if (entity.type === 'SEQEND' && pendingPolyline) {
      paths.push(pendingPolyline)
      pendingPolyline = null
    } else if (entity.type === 'LINE') {
      lines.push({
        start: [numeric(entity, 10), numeric(entity, 20)],
        end: [numeric(entity, 11), numeric(entity, 21)],
        layer,
        color,
      })
      entityCount++
    } else if (entity.type === 'CIRCLE') {
      const center: Point = [numeric(entity, 10), numeric(entity, 20)]
      const radius = Math.abs(numeric(entity, 40))
      paths.push({
        layer,
        color,
        closed: true,
        points: Array.from({ length: 72 }, (_, index) => {
          const angle = (index / 72) * Math.PI * 2
          return [
            center[0] + Math.cos(angle) * radius,
            center[1] + Math.sin(angle) * radius,
          ]
        }),
      })
      entityCount++
    } else if (entity.type === 'ELLIPSE') {
      const center: Point = [numeric(entity, 10), numeric(entity, 20)]
      const major: Point = [numeric(entity, 11), numeric(entity, 21)]
      const ratio = Math.abs(numeric(entity, 40, 1))
      const start = numeric(entity, 41, 0),
        end = numeric(entity, 42, Math.PI * 2)
      const sweep = end > start ? end - start : end - start + Math.PI * 2
      const closed = Math.abs(sweep - Math.PI * 2) < 1e-4
      paths.push({
        layer,
        color,
        closed,
        points: Array.from({ length: 73 }, (_, index) => {
          const angle = start + (sweep * index) / 72
          return [
            center[0] +
              major[0] * Math.cos(angle) -
              major[1] * ratio * Math.sin(angle),
            center[1] +
              major[1] * Math.cos(angle) +
              major[0] * ratio * Math.sin(angle),
          ]
        }),
      })
      entityCount++
    } else if (!['SECTION', 'ENDSEC', 'EOF'].includes(entity.type))
      warnings.add(`DXF-Element „${entity.type}“ wird noch nicht unterstützt.`)
  }
  paths.push(...chainLines(lines))
  if (!paths.length)
    throw new Error('Die DXF-Datei enthält keine unterstützte Vektorgeometrie.')
  const allPoints = paths.flatMap((path) => path.points)
  const minX = Math.min(...allPoints.map(([x]) => x)),
    maxX = Math.max(...allPoints.map(([x]) => x))
  const minY = Math.min(...allPoints.map(([, y]) => y)),
    maxY = Math.max(...allPoints.map(([, y]) => y))
  const width = Math.max(0.1, maxX - minX),
    height = Math.max(0.1, maxY - minY)
  const svgPaths = paths
    .map((path, index) => {
      if (!path.closed)
        warnings.add(
          `Offene Kontur auf Layer „${path.layer}“ wurde nur zur Vorschau übernommen.`,
        )
      const points =
        path.closed && samePoint(path.points[0], path.points.at(-1)!)
          ? path.points.slice(0, -1)
          : path.points
      const data = points.length
        ? `M ${points.map(([x, y]) => `${number(x)} ${number(y)}`).join(' L ')}${path.closed ? ' Z' : ''}`
        : ''
      return `<path id="dxf-${index}" aria-label="${escapeXml(path.layer)}" d="${data}" fill="${path.closed ? path.color : 'none'}" fill-rule="evenodd" stroke="${path.color}" stroke-width="0.1"/>`
    })
    .join('')
  return {
    svg: `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="${number(width * factor)}mm" height="${number(height * factor)}mm" viewBox="${number(minX)} ${number(minY)} ${number(width)} ${number(height)}">${svgPaths}</svg>`,
    entityCount,
    units,
    hasReliableSize: unitIndex in unitFactors,
    warnings: [...warnings],
  }
}
