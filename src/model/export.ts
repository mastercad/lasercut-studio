import JSZip from 'jszip'
import { Euler, Quaternion, Vector3, type BufferGeometry } from 'three'
import {
  thinAxis,
  type LaserTextDefinition,
  type MaterialDefinition,
  type PanelDefinition,
} from './box'
import { createEvaluatedPanelGeometry } from './panelGeometry'
import { createLbrn2Project } from './lbrn2'

export type ExportOperation =
  'engrave-fill' | 'engrave-line' | 'score' | 'cut-inner' | 'cut-outer' | 'tool'
export type ExportMode = 'line' | 'fill' | 'offset-fill'
export type ExportLayerDefinition = {
  id: string
  materialId: string
  operation: ExportOperation
  name: string
  color: string
  mode: ExportMode
  speed: number
  power: number
  minPower?: number
  passes: number
  airAssist: boolean
  output: boolean
  order: number
}
export type LaserCutterDefinition = {
  id: string
  name: string
  powerWatts: number
  bedWidth?: number
  bedHeight?: number
  speedUnit: 'mm/min' | 'mm/s'
  notes: string
}
export type LaserPreset = {
  id: string
  laserId: string
  materialId: string
  operation: ExportOperation
  speed: number
  power: number
  minPower?: number
  passes: number
  airAssist: boolean
  mode: ExportMode
  layerColor?: string
}
export type ProcessingProfile = {
  id: string
  name: string
  geometry: 'fill' | 'contour'
  referenceDepth?: number
  color: string
  order: number
  source?: {
    format: 'lightburn'
    deviceName: string
    cutIndex: number
    operation: string
    fingerprint?: string
  }
}
export type ProcessingRecipe = {
  id: string
  profileId: string
  laserId: string
  materialId: string
  speed: number
  power: number
  passes: number
  airAssist: boolean
  lineInterval: number
  focusOffset: number
  layerColor: string
  minPower?: number
  sourceCutIndex?: number
  sourceOperation?: string
  output?: boolean
  sourceParameters?: Record<string, number>
}
export type ExportGroupInfo = { id: string; name: string; panelIds: string[] }
export const defaultLaserCutters: LaserCutterDefinition[] = [
  {
    id: 'generic-10w',
    name: 'Generischer Diodenlaser',
    powerWatts: 10,
    bedWidth: 400,
    bedHeight: 400,
    speedUnit: 'mm/min',
    notes: 'Werte vor dem Lasern an der eigenen Maschine prüfen.',
  },
]

const operations: Array<
  Omit<ExportLayerDefinition, 'id' | 'materialId' | 'color' | 'order'>
> = [
  {
    operation: 'engrave-fill',
    name: 'Flächengravur',
    mode: 'fill',
    speed: 200,
    power: 20,
    passes: 1,
    airAssist: false,
    output: true,
  },
  {
    operation: 'engrave-line',
    name: 'Konturgravur',
    mode: 'line',
    speed: 150,
    power: 18,
    passes: 1,
    airAssist: false,
    output: true,
  },
  {
    operation: 'score',
    name: 'Markierung / Score',
    mode: 'line',
    speed: 100,
    power: 15,
    passes: 1,
    airAssist: false,
    output: true,
  },
  {
    operation: 'cut-inner',
    name: 'Innenschnitt',
    mode: 'line',
    speed: 10,
    power: 100,
    passes: 1,
    airAssist: true,
    output: true,
  },
  {
    operation: 'cut-outer',
    name: 'Außenschnitt',
    mode: 'line',
    speed: 10,
    power: 100,
    passes: 1,
    airAssist: true,
    output: true,
  },
  {
    operation: 'tool',
    name: 'Hilfsgeometrie',
    mode: 'line',
    speed: 0,
    power: 0,
    passes: 1,
    airAssist: false,
    output: false,
  },
]
const palette = [
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

export function createDefaultExportLayers(
  materials: MaterialDefinition[],
): ExportLayerDefinition[] {
  let order = 0
  return materials.flatMap((material, materialIndex) =>
    operations.map((operation, operationIndex) => ({
      ...operation,
      id: `${material.id}:${operation.operation}`,
      materialId: material.id,
      color:
        palette[
          (materialIndex * operations.length + operationIndex) % palette.length
        ],
      order: order++,
    })),
  )
}

export function createDefaultLaserPresets(
  lasers: LaserCutterDefinition[],
  materials: MaterialDefinition[],
): LaserPreset[] {
  const defaults = createDefaultExportLayers(materials)
  return lasers.flatMap((laser) =>
    defaults
      .filter((layer) => layer.operation !== 'tool')
      .map((layer) => ({
        id: `${laser.id}:${layer.materialId}:${layer.operation}`,
        laserId: laser.id,
        materialId: layer.materialId,
        operation: layer.operation,
        speed: layer.speed,
        power: layer.power,
        passes: layer.passes,
        airAssist: layer.airAssist,
        mode: layer.mode,
        layerColor: layer.color,
      })),
  )
}

export function createDefaultProcessingProfiles(): ProcessingProfile[] {
  return [
    {
      id: 'profile-engrave-light',
      name: 'Leichte Flächengravur',
      geometry: 'fill',
      referenceDepth: 0.1,
      color: '#d000d0',
      order: 0,
    },
    {
      id: 'profile-engrave-deep',
      name: 'Tiefe Flächengravur',
      geometry: 'fill',
      referenceDepth: 0.8,
      color: '#707070',
      order: 1,
    },
    {
      id: 'profile-engrave-line',
      name: 'Feine Konturgravur',
      geometry: 'contour',
      referenceDepth: 0.1,
      color: '#7f0000',
      order: 2,
    },
  ]
}

export function createDefaultProcessingRecipes(
  profiles: ProcessingProfile[],
  lasers: LaserCutterDefinition[],
  materials: MaterialDefinition[],
): ProcessingRecipe[] {
  return lasers.flatMap((laser) =>
    materials.flatMap((material) =>
      profiles.map((profile) => ({
        id: `${laser.id}:${material.id}:${profile.id}`,
        profileId: profile.id,
        laserId: laser.id,
        materialId: material.id,
        speed:
          profile.id === 'profile-engrave-deep'
            ? 40
            : profile.geometry === 'fill'
              ? 200
              : 150,
        power:
          profile.id === 'profile-engrave-deep'
            ? 55
            : profile.geometry === 'fill'
              ? 20
              : 18,
        passes: profile.id === 'profile-engrave-deep' ? 3 : 1,
        airAssist: false,
        lineInterval: 0.1,
        focusOffset: 0,
        layerColor: profile.color,
      })),
    ),
  )
}

type Point = [number, number]
export type PanelContours = {
  outer: Point[][]
  inner: Point[][]
  width: number
  height: number
  minX: number
  maxY: number
}
export type ContourProvider = (
  panel: PanelDefinition,
  panels: PanelDefinition[],
) => PanelContours
const key = (point: Point) =>
  `${Math.round(point[0] * 1000)},${Math.round(point[1] * 1000)}`
const area = (loop: Point[]) =>
  loop.reduce((sum, point, index) => {
    const next = loop[(index + 1) % loop.length]
    return sum + point[0] * next[1] - next[0] * point[1]
  }, 0) / 2
const contains = (loop: Point[], point: Point) => {
  let inside = false
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const [xi, yi] = loop[i],
      [xj, yj] = loop[j]
    if (
      yi > point[1] !== yj > point[1] &&
      point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi
    )
      inside = !inside
  }
  return inside
}

export function extractPanelContours(
  panel: PanelDefinition,
  panels: PanelDefinition[],
): PanelContours {
  const geometry = createEvaluatedPanelGeometry(panel, panels)
  const position = geometry.getAttribute('position')
  const thin = thinAxis(panel)
  const planeAxes = ([0, 1, 2] as const).filter((axis) => axis !== thin)
  if (!position?.count) {
    geometry.dispose()
    return { outer: [], inner: [], width: 0, height: 0, minX: 0, maxY: 0 }
  }
  // CSG operations and cylindrical reliefs can leave isolated vertices beyond
  // the sheet face. The maximum coordinate is therefore not necessarily the
  // actual plate surface. Use the most frequently occurring positive face
  // coordinate instead; planar sheet faces contribute by far the most vertices.
  const surfaceBuckets = new Map<number, number>()
  for (let index = 0; index < position.count; index++) {
    const value = position.getComponent(index, thin)
    if (!Number.isFinite(value)) continue
    const bucket = Math.round(value * 100) / 100
    surfaceBuckets.set(bucket, (surfaceBuckets.get(bucket) ?? 0) + 1)
  }
  const surface = [...surfaceBuckets.entries()].sort(
    (a, b) => b[1] - a[1] || b[0] - a[0],
  )[0]?.[0]
  if (surface === undefined) {
    geometry.dispose()
    return { outer: [], inner: [], width: 0, height: 0, minX: 0, maxY: 0 }
  }
  const indexAttribute = geometry.getIndex()
  const triangleVertexCount = indexAttribute?.count ?? position.count
  const vertexIndex = (triangleOffset: number) =>
    indexAttribute ? indexAttribute.getX(triangleOffset) : triangleOffset
  const edges = new Map<string, { a: Point; b: Point; count: number }>()
  const addEdge = (a: Point, b: Point) => {
    const ak = key(a),
      bk = key(b),
      edgeKey = ak < bk ? `${ak}|${bk}` : `${bk}|${ak}`
    const existing = edges.get(edgeKey)
    if (existing) existing.count++
    else edges.set(edgeKey, { a, b, count: 1 })
  }
  for (let index = 0; index < triangleVertexCount; index += 3) {
    const points = [0, 1, 2].map((offset) => {
      const vertex = vertexIndex(index + offset)
      return [
        position.getComponent(vertex, planeAxes[0]),
        position.getComponent(vertex, planeAxes[1]),
      ] as Point
    })
    // Boundary edges are read from vertical side triangles: exactly two of
    // their vertices lie on the upper sheet surface. This avoids leaking the
    // CSG triangulation and T-junctions of the large top face into the export.
    const topVertices = [0, 1, 2].filter(
      (offset) =>
        Math.abs(
          position.getComponent(vertexIndex(index + offset), thin) - surface,
        ) < 0.025,
    )
    if (topVertices.length === 2)
      addEdge(points[topVertices[0]], points[topVertices[1]])
  }
  geometry.dispose()
  const adjacency = new Map<string, Point[]>()
  for (const edge of edges.values())
    if (edge.count === 1) {
      for (const [from, to] of [
        [edge.a, edge.b],
        [edge.b, edge.a],
      ] as const)
        adjacency.set(key(from), [...(adjacency.get(key(from)) ?? []), to])
    }
  const unused = new Set(
    [...edges.entries()]
      .filter(([, edge]) => edge.count === 1)
      .map(([edgeKey]) => edgeKey),
  )
  const loops: Point[][] = []
  while (unused.size) {
    const firstKey = unused.values().next().value as string
    const firstEdge = edges.get(firstKey)!
    const loop: Point[] = [firstEdge.a]
    let current = firstEdge.a,
      next = firstEdge.b
    for (let guard = 0; guard < 100000; guard++) {
      loop.push(next)
      const currentKey = key(current),
        nextKey = key(next)
      unused.delete(
        currentKey < nextKey
          ? `${currentKey}|${nextKey}`
          : `${nextKey}|${currentKey}`,
      )
      if (nextKey === key(loop[0])) break
      const candidates = adjacency.get(nextKey) ?? []
      const candidate = candidates.find((point) => {
        const candidateKey = key(point)
        return unused.has(
          nextKey < candidateKey
            ? `${nextKey}|${candidateKey}`
            : `${candidateKey}|${nextKey}`,
        )
      })
      if (!candidate) break
      current = next
      next = candidate
    }
    if (loop.length >= 4 && key(loop[0]) === key(loop.at(-1)!))
      loops.push(loop.slice(0, -1))
  }
  const meaningful = loops.filter((loop) => Math.abs(area(loop)) > 0.001)
  const outer: Point[][] = [],
    inner: Point[][] = []
  for (const loop of meaningful) {
    const depth = meaningful.filter(
      (other) =>
        other !== loop &&
        Math.abs(area(other)) > Math.abs(area(loop)) &&
        contains(other, loop[0]),
    ).length
    ;(depth % 2 ? inner : outer).push(loop)
  }
  const all = meaningful.flat()
  if (!all.length)
    return { outer: [], inner: [], width: 0, height: 0, minX: 0, maxY: 0 }
  const minX = Math.min(...all.map((point) => point[0])),
    maxX = Math.max(...all.map((point) => point[0]))
  const minY = Math.min(...all.map((point) => point[1])),
    maxY = Math.max(...all.map((point) => point[1]))
  const normalize = (loop: Point[]) =>
    loop.map(([x, y]) => [x - minX, maxY - y] as Point)
  return {
    outer: outer.map(normalize),
    inner: inner.map(normalize),
    width: maxX - minX,
    height: maxY - minY,
    minX,
    maxY,
  }
}

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
const path = (loop: Point[], offset: Point) =>
  `M ${loop.map(([x, y]) => `${(x + offset[0]).toFixed(3)},${(y + offset[1]).toFixed(3)}`).join(' L ')} Z`

const dxfValue = (value: string | number) => `${value}`.replace(/[\r\n]/g, ' ')
const dxfPair = (code: number, value: string | number) =>
  `${code}\n${dxfValue(value)}\n`
const dxfNumber = (value: number) =>
  Number.isFinite(value) ? Number(value.toFixed(6)) : 0
const dxfColor = (color: string) => {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(color)
  return match
    ? (Number.parseInt(match[1], 16) << 16) |
        (Number.parseInt(match[2], 16) << 8) |
        Number.parseInt(match[3], 16)
    : 0
}
const dxfLayerName = (order: number, name: string) =>
  `${String(order + 1).padStart(2, '0')}_${safeName(name)}`.slice(0, 255)

type DxfLayer = { name: string; color: string }
type DxfPolyline = {
  layer: string
  color: string
  loop: Point[]
  offset: Point
}

/** ASCII DXF 2000 with millimetre units and closed lightweight polylines.
 * True-colour values preserve the LightBurn layer colours while the layer
 * table keeps processing steps separate in other CAD applications as well. */
function createDxf(
  layers: DxfLayer[],
  polylines: DxfPolyline[],
  width: number,
  height: number,
) {
  const header =
    dxfPair(0, 'SECTION') +
    dxfPair(2, 'HEADER') +
    dxfPair(9, '$ACADVER') +
    dxfPair(1, 'AC1015') +
    dxfPair(9, '$INSUNITS') +
    dxfPair(70, 4) +
    dxfPair(9, '$EXTMIN') +
    dxfPair(10, 0) +
    dxfPair(20, 0) +
    dxfPair(30, 0) +
    dxfPair(9, '$EXTMAX') +
    dxfPair(10, dxfNumber(width)) +
    dxfPair(20, dxfNumber(height)) +
    dxfPair(30, 0) +
    dxfPair(0, 'ENDSEC')
  const layerTable =
    dxfPair(0, 'SECTION') +
    dxfPair(2, 'TABLES') +
    dxfPair(0, 'TABLE') +
    dxfPair(2, 'LAYER') +
    dxfPair(70, layers.length) +
    layers
      .map(
        (layer) =>
          dxfPair(0, 'LAYER') +
          dxfPair(2, layer.name) +
          dxfPair(70, 0) +
          dxfPair(62, 7) +
          dxfPair(420, dxfColor(layer.color)) +
          dxfPair(6, 'CONTINUOUS'),
      )
      .join('') +
    dxfPair(0, 'ENDTAB') +
    dxfPair(0, 'ENDSEC')
  const entities =
    dxfPair(0, 'SECTION') +
    dxfPair(2, 'ENTITIES') +
    polylines
      .filter(({ loop }) => loop.length >= 2)
      .map(
        ({ layer, color, loop, offset }) =>
          dxfPair(0, 'LWPOLYLINE') +
          dxfPair(100, 'AcDbEntity') +
          dxfPair(8, layer) +
          dxfPair(420, dxfColor(color)) +
          dxfPair(100, 'AcDbPolyline') +
          dxfPair(90, loop.length) +
          dxfPair(70, 1) +
          loop
            .map(
              ([x, y]) =>
                dxfPair(10, dxfNumber(x + offset[0])) +
                dxfPair(20, dxfNumber(height - y - offset[1])),
            )
            .join(''),
      )
      .join('') +
    dxfPair(0, 'ENDSEC')
  return `${header}${layerTable}${entities}${dxfPair(0, 'EOF')}`
}

type PackableItem = { contours: PanelContours }

export type PackRectangle = {
  width: number
  height: number
}

type PackedRectangle<T> = T & { offset: Point }

const packAtWidth = <T extends PackRectangle>(
  items: Array<{ item: T; index: number }>,
  contentWidth: number,
  gap: number,
  margin: number,
) => {
  const placed: Array<PackedRectangle<T>> = []
  let usedWidth = 0
  let usedHeight = 0

  for (const { item } of items) {
    const xCandidates = [margin]
    const yCandidates = [margin]
    for (const other of placed) {
      xCandidates.push(other.offset[0] + other.width + gap)
      yCandidates.push(other.offset[1] + other.height + gap)
    }

    let best: Point | undefined
    for (const y of [...new Set(yCandidates)].sort((a, b) => a - b)) {
      for (const x of [...new Set(xCandidates)].sort((a, b) => a - b)) {
        if (x + item.width > margin + contentWidth + 0.000001) continue
        const overlaps = placed.some(
          (other) =>
            x < other.offset[0] + other.width + gap &&
            x + item.width + gap > other.offset[0] &&
            y < other.offset[1] + other.height + gap &&
            y + item.height + gap > other.offset[1],
        )
        if (!overlaps) {
          best = [x, y]
          break
        }
      }
      if (best) break
    }

    // The margin candidate always fits vertically because the layout has no
    // fixed height. This is only a defensive fallback for malformed sizes.
    const offset = best ?? [margin, usedHeight + margin + gap]
    placed.push({ ...item, offset })
    usedWidth = Math.max(usedWidth, offset[0] + item.width - margin)
    usedHeight = Math.max(usedHeight, offset[1] + item.height - margin)
  }

  return {
    placed,
    width: Math.max(20, usedWidth + margin * 2),
    height: Math.max(20, usedHeight + margin * 2),
  }
}

/** Deterministic best-fit layout shared by import and export. It tries several
 * widths and places every rectangle at the first free bottom-left corner. In
 * contrast to a shelf layout, short parts can occupy space below tall parts. */
export function packRectangles<T extends PackRectangle>(
  items: T[],
  gap = 10,
  margin = 10,
  maxWidth?: number,
  maxHeight?: number,
) {
  if (!items.length)
    return {
      placed: [] as Array<T & { offset: Point }>,
      width: margin * 2,
      height: margin * 2,
    }

  const totalArea = items.reduce(
    (sum, item) => sum + item.width * item.height,
    0,
  )
  const widest = Math.max(...items.map((item) => item.width))
  const totalWidth = items.reduce((sum, item) => sum + item.width, 0)
  const sorted = items
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        b.item.height - a.item.height ||
        b.item.width - a.item.width ||
        a.index - b.index,
    )

  const ideal = Math.sqrt(totalArea)
  const candidateWidths = new Set<number>([widest, totalWidth])
  for (const factor of [0.75, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2])
    candidateWidths.add(Math.max(widest, ideal * factor))
  for (const { item } of sorted)
    candidateWidths.add(Math.max(widest, item.width + widest + gap))

  const layouts = [...candidateWidths]
    .filter((width) => maxWidth === undefined || width <= maxWidth - margin * 2)
    .map((width) => packAtWidth(sorted, width, gap, margin))
    .filter(
      (layout) =>
        (maxWidth === undefined || layout.width <= maxWidth) &&
        (maxHeight === undefined || layout.height <= maxHeight),
    )
    .sort((a, b) => {
      const score = (layout: typeof a) => {
        const contentWidth = layout.width - margin * 2
        const contentHeight = layout.height - margin * 2
        const aspectPenalty =
          1 + 0.08 * Math.abs(Math.log(contentWidth / contentHeight))
        return contentWidth * contentHeight * aspectPenalty
      }
      return score(a) - score(b) || a.width - b.width
    })
  if (!layouts.length)
    throw new Error(
      'Die Teile passen nicht auf die konfigurierte Schnittfläche.',
    )
  return layouts[0]
}

type ExportItem = PackableItem & { panel: PanelDefinition }

const assignedProfileContours = (
  panel: PanelDefinition,
  fallback: PanelContours,
  profileId?: string,
): PanelContours => {
  if (!profileId) return fallback
  const faces = (panel.processingAssignments ?? [])
    .filter((assignment) => assignment.profileId === profileId)
    .flatMap((assignment) => assignment.faces ?? [])
  const importedFaces = (panel.importedOperations ?? [])
    .filter((operation) => operation.profileId === profileId)
    .flatMap((operation) => operation.faces)
  const assignedFaces = [...faces, ...importedFaces]
  if (!assignedFaces.length) return fallback
  const points = assignedFaces
    .flatMap((face) => [face.outer, ...face.holes])
    .flat()
  return {
    outer: assignedFaces.map((face) => face.outer),
    inner: assignedFaces.flatMap((face) => face.holes),
    width:
      Math.max(...points.map((point) => point[0])) -
      Math.min(...points.map((point) => point[0])),
    height:
      Math.max(...points.map((point) => point[1])) -
      Math.min(...points.map((point) => point[1])),
    minX: Math.min(...points.map((point) => point[0])),
    maxY: Math.max(...points.map((point) => point[1])),
  }
}

const panelQuaternion = (panel: PanelDefinition) =>
  new Quaternion().setFromEuler(new Euler(...panel.rotation, 'XYZ'))

const isStandaloneEngraving = (panel: PanelDefinition) =>
  panel.autoCut === false && Boolean(panel.processingAssignments?.length)

/** Projects engraving-only geometry onto overlapping cut geometry. Plane
 * distance does not disqualify an engraving (it may sit slightly inside its
 * host in the editor), but it must decide between otherwise overlapping,
 * parallel panels. */
function attachEngravingsToHosts(items: ExportItem[]) {
  const hosts = items.filter((item) => !isStandaloneEngraving(item.panel))
  const hostByEngraving = new Map<
    string,
    { host: ExportItem; contours: PanelContours }
  >()

  for (const engraving of items.filter((item) =>
    isStandaloneEngraving(item.panel),
  )) {
    const engravingQuaternion = panelQuaternion(engraving.panel)
    const engravingThin = thinAxis(engraving.panel)
    const engravingAxes = ([0, 1, 2] as const).filter(
      (axis) => axis !== engravingThin,
    )
    const engravingNormal = new Vector3(0, 0, 0)
    engravingNormal.setComponent(engravingThin, 1)
    engravingNormal.applyQuaternion(engravingQuaternion).normalize()

    const candidates = hosts
      .map((host) => {
        const hostThin = thinAxis(host.panel)
        const hostAxes = ([0, 1, 2] as const).filter(
          (axis) => axis !== hostThin,
        )
        const hostQuaternion = panelQuaternion(host.panel)
        const hostNormal = new Vector3(0, 0, 0)
        hostNormal.setComponent(hostThin, 1)
        hostNormal.applyQuaternion(hostQuaternion).normalize()
        const normalAlignment = engravingNormal.dot(hostNormal)
        const aligned = Math.abs(normalAlignment) > 0.98
        const inverseHostQuaternion = hostQuaternion.clone().invert()
        const hostPosition = new Vector3(...host.panel.position)
        const engravingPosition = new Vector3(...engraving.panel.position)
        const planeDistance = Math.abs(
          engravingPosition.clone().sub(hostPosition).dot(hostNormal),
        )
        const transformLoop = (loop: Point[]) =>
          loop.map(([x, y]) => {
            const local = new Vector3()
            // Flatten both faces as they are seen from outside. Without this
            // correction an engraving placed on the panel's negative face is
            // viewed through the opaque sheet and therefore mirrored.
            local.setComponent(
              engravingAxes[0],
              (normalAlignment < 0 ? -1 : 1) * (x + engraving.contours.minX),
            )
            local.setComponent(engravingAxes[1], engraving.contours.maxY - y)
            const inHost = local
              .applyQuaternion(engravingQuaternion)
              .add(engravingPosition)
              .sub(hostPosition)
              .applyQuaternion(inverseHostQuaternion)
            return [
              inHost.getComponent(hostAxes[0]) - host.contours.minX,
              host.contours.maxY - inHost.getComponent(hostAxes[1]),
            ] as Point
          })
        const projectedContours: PanelContours = {
          ...engraving.contours,
          outer: engraving.contours.outer.map(transformLoop),
          inner: engraving.contours.inner.map(transformLoop),
        }
        const projectedPoints = [
          ...projectedContours.outer,
          ...projectedContours.inner,
        ].flat()
        const minX = Math.min(...projectedPoints.map((point) => point[0]))
        const maxX = Math.max(...projectedPoints.map((point) => point[0]))
        const minY = Math.min(...projectedPoints.map((point) => point[1]))
        const maxY = Math.max(...projectedPoints.map((point) => point[1]))
        const overlapWidth = Math.max(
          0,
          Math.min(maxX, host.contours.width) - Math.max(minX, 0),
        )
        const overlapHeight = Math.max(
          0,
          Math.min(maxY, host.contours.height) - Math.max(minY, 0),
        )
        const overlapArea = overlapWidth * overlapHeight
        const projectedArea = Math.max(0.000001, (maxX - minX) * (maxY - minY))
        return {
          host,
          contours: projectedContours,
          overlapArea,
          overlapRatio: overlapArea / projectedArea,
          planeDistance,
          hostArea: host.contours.width * host.contours.height,
          eligible: aligned && overlapWidth > 0.001 && overlapHeight > 0.001,
        }
      })
      .filter((candidate) => candidate.eligible)
      .sort(
        (a, b) =>
          a.planeDistance - b.planeDistance ||
          b.overlapRatio - a.overlapRatio ||
          b.overlapArea - a.overlapArea ||
          a.hostArea - b.hostArea,
      )

    const match = candidates[0]
    if (!match) continue
    hostByEngraving.set(engraving.panel.id, {
      host: match.host,
      contours: match.contours,
    })
  }
  return { hosts, hostByEngraving }
}

/**
 * Arrange parts on compact shelves. The old exporter put every part into one
 * endlessly wide row, which made both the preview and the resulting job hard
 * to use. Sorting tall parts first keeps shelf heights stable and gives a
 * deterministic, reasonably square layout without rotating user geometry.
 */
function packItems<T extends PackableItem>(
  items: T[],
  gap = 10,
  margin = 10,
  sheetSize?: { width: number; height: number },
) {
  const packed = packRectangles(
    items.map((item) => ({
      item,
      width: item.contours.width,
      height: item.contours.height,
    })),
    gap,
    margin,
    sheetSize?.width,
    sheetSize?.height,
  )
  return {
    ...packed,
    placed: packed.placed.map(({ item, offset }) => ({ ...item, offset })),
  }
}

export function splitPanelsIntoSheets(
  materialPanels: PanelDefinition[],
  allPanels: PanelDefinition[],
  bedWidth: number,
  bedHeight: number,
  contoursFor: ContourProvider = extractPanelContours,
  gap = 10,
  margin = 10,
) {
  const usableWidth = bedWidth - margin * 2
  const usableHeight = bedHeight - margin * 2
  if (usableWidth <= 0 || usableHeight <= 0)
    throw new Error('Die konfigurierte Schnittfläche ist zu klein.')
  const items = materialPanels
    .filter((panel) => !panel.hidden && panel.visible !== false)
    .map((panel, index) => ({
      panel,
      index,
      contours: contoursFor(panel, allPanels),
    }))
    .filter((item) => item.contours.outer.length || item.contours.inner.length)
    .sort(
      (a, b) =>
        b.contours.height - a.contours.height ||
        b.contours.width - a.contours.width ||
        a.index - b.index,
    )
  type Sheet = {
    panels: PanelDefinition[]
    cursorX: number
    cursorY: number
    rowHeight: number
  }
  const sheets: Sheet[] = []
  for (const item of items) {
    const { width, height } = item.contours
    if (width > usableWidth || height > usableHeight)
      throw new Error(
        `„${item.panel.label}“ (${width.toFixed(1)} × ${height.toFixed(1)} mm) passt nicht auf die Schnittfläche ${bedWidth} × ${bedHeight} mm.`,
      )
    let target = sheets.find((sheet) => {
      const fitsRow =
        sheet.cursorX === 0 || sheet.cursorX + width <= usableWidth
      const y = fitsRow ? sheet.cursorY : sheet.cursorY + sheet.rowHeight + gap
      return y + height <= usableHeight
    })
    if (!target) {
      target = { panels: [], cursorX: 0, cursorY: 0, rowHeight: 0 }
      sheets.push(target)
    }
    if (target.cursorX > 0 && target.cursorX + width > usableWidth) {
      target.cursorX = 0
      target.cursorY += target.rowHeight + gap
      target.rowHeight = 0
    }
    target.panels.push(item.panel)
    target.cursorX += width + gap
    target.rowHeight = Math.max(target.rowHeight, height)
  }
  return sheets.map((sheet) => sheet.panels)
}

function placeExportItems(
  items: ExportItem[],
  gap = 10,
  margin = 10,
  sheetSize?: { width: number; height: number },
) {
  const { hosts, hostByEngraving } = attachEngravingsToHosts(items)
  const unattached = items.filter(
    (item) =>
      !isStandaloneEngraving(item.panel) || !hostByEngraving.has(item.panel.id),
  )
  const packed = packItems(unattached, gap, margin, sheetSize)
  const placedById = new Map(
    packed.placed.map((item) => [item.panel.id, item] as const),
  )
  const attached = [...hostByEngraving.entries()].flatMap(
    ([engravingId, attachment]) => {
      const engraving = items.find((item) => item.panel.id === engravingId)
      const host = placedById.get(attachment.host.panel.id)
      return engraving && host
        ? [{ ...engraving, contours: attachment.contours, offset: host.offset }]
        : []
    },
  )
  return { ...packed, placed: [...packed.placed, ...attached], hosts }
}
const safeName = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/ß/g, 'ss')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'Material'

export type ProjectExportStep = {
  id: string
  materialId: string
  name: string
  kind: 'profile' | 'cut-inner' | 'cut-outer'
  color: string
  mode: ExportMode
  speed: number
  power: number
  minPower?: number
  passes: number
  airAssist: boolean
  objectIds: string[]
  contourCount: number
  profileId?: string
  referenceDepth?: number
  lineInterval?: number
  focusOffset?: number
  configured: boolean
  output?: boolean
  sourceParameters?: Record<string, number>
}

type CutPresets = { inner?: LaserPreset; outer?: LaserPreset }

export function buildProjectExportSteps(
  material: MaterialDefinition,
  panels: PanelDefinition[],
  profiles: ProcessingProfile[],
  recipes: ProcessingRecipe[],
  laserId: string,
  cutPreset?: LaserPreset | CutPresets,
  contoursFor: ContourProvider = extractPanelContours,
): ProjectExportStep[] {
  const visible = panels.filter(
    (panel) =>
      !panel.hidden &&
      panel.visible !== false &&
      panel.materialId === material.id,
  )
  const evaluated = visible.map((panel) => ({
    panel,
    contours: contoursFor(panel, panels),
  }))
  const usedProfiles = profiles
    .filter((profile) =>
      visible.some((panel) =>
        panel.processingAssignments?.some(
          (assignment) => assignment.profileId === profile.id,
        ),
      ),
    )
    .sort((a, b) => a.order - b.order)
  const profileSteps = usedProfiles.flatMap((profile): ProjectExportStep[] => {
    const assigned = evaluated.filter(({ panel }) =>
      panel.processingAssignments?.some(
        (assignment) => assignment.profileId === profile.id,
      ),
    )
    if (!assigned.length) return []
    const recipe = recipes.find(
      (candidate) =>
        candidate.profileId === profile.id &&
        candidate.laserId === laserId &&
        candidate.materialId === material.id,
    )
    return [
      {
        id: `profile:${profile.id}`,
        profileId: profile.id,
        materialId: material.id,
        name: profile.name,
        kind: 'profile',
        color: recipe?.layerColor ?? profile.color,
        mode: profile.geometry === 'fill' ? 'fill' : 'line',
        speed: recipe?.speed ?? 0,
        power: recipe?.power ?? 0,
        minPower: recipe?.minPower,
        passes: recipe?.passes ?? 0,
        airAssist: recipe?.airAssist ?? false,
        configured: Boolean(recipe),
        referenceDepth: profile.referenceDepth,
        lineInterval: recipe?.lineInterval,
        focusOffset: recipe?.focusOffset,
        output: recipe?.output,
        sourceParameters: recipe?.sourceParameters,
        objectIds: assigned.map(({ panel }) => panel.id),
        contourCount: assigned.reduce((sum, { panel, contours }) => {
          const assignedContours = assignedProfileContours(
            panel,
            contours,
            profile.id,
          )
          const assignment = panel.processingAssignments?.find(
            (candidate) => candidate.profileId === profile.id,
          )
          return (
            sum +
            (assignment?.geometry === 'fill'
              ? assignedContours.outer.length
              : assignedContours.outer.length + assignedContours.inner.length)
          )
        }, 0),
      },
    ]
  })
  const cutItems = evaluated.filter(({ panel }) => panel.autoCut !== false)
  const legacyCut =
    cutPreset && 'operation' in cutPreset ? cutPreset : undefined
  const innerCut =
    !cutPreset || 'operation' in cutPreset ? legacyCut : cutPreset.inner
  const outerCut =
    !cutPreset || 'operation' in cutPreset ? legacyCut : cutPreset.outer
  const cutFallback = {
    speed: 10,
    power: 100,
    passes: 1,
    airAssist: true,
    mode: 'line' as const,
  }
  const innerObjects = cutItems.filter(({ contours }) => contours.inner.length)
  const outerObjects = cutItems.filter(({ contours }) => contours.outer.length)
  return [
    ...profileSteps,
    ...(innerObjects.length
      ? [
          {
            id: `cut-inner:${material.id}`,
            materialId: material.id,
            name: 'Innenschnitte · automatisch erkannt',
            kind: 'cut-inner' as const,
            color: innerCut?.layerColor ?? '#00b000',
            mode: 'line' as const,
            speed: innerCut?.speed ?? cutFallback.speed,
            power: innerCut?.power ?? cutFallback.power,
            passes: innerCut?.passes ?? cutFallback.passes,
            airAssist: innerCut?.airAssist ?? cutFallback.airAssist,
            configured: Boolean(innerCut),
            objectIds: innerObjects.map(({ panel }) => panel.id),
            contourCount: innerObjects.reduce(
              (sum, item) => sum + item.contours.inner.length,
              0,
            ),
          },
        ]
      : []),
    ...(outerObjects.length
      ? [
          {
            id: `cut-outer:${material.id}`,
            materialId: material.id,
            name: 'Außenschnitte · automatisch erkannt',
            kind: 'cut-outer' as const,
            color: outerCut?.layerColor ?? '#c0a000',
            mode: 'line' as const,
            speed: outerCut?.speed ?? cutFallback.speed,
            power: outerCut?.power ?? cutFallback.power,
            passes: outerCut?.passes ?? cutFallback.passes,
            airAssist: outerCut?.airAssist ?? cutFallback.airAssist,
            configured: Boolean(outerCut),
            objectIds: outerObjects.map(({ panel }) => panel.id),
            contourCount: outerObjects.reduce(
              (sum, item) => sum + item.contours.outer.length,
              0,
            ),
          },
        ]
      : []),
  ]
}

export function createProfiledMaterialSvg(
  material: MaterialDefinition,
  materialPanels: PanelDefinition[],
  allPanels: PanelDefinition[],
  profiles: ProcessingProfile[],
  recipes: ProcessingRecipe[],
  laserId: string,
  cutPreset?: LaserPreset | CutPresets,
  groups: ExportGroupInfo[] = [],
  contoursFor: ContourProvider = extractPanelContours,
  sheetSize?: { width: number; height: number },
) {
  const gap = 10,
    margin = 10
  const items = materialPanels
    .filter((panel) => !panel.hidden && panel.visible !== false)
    .map((panel) => ({ panel, contours: contoursFor(panel, allPanels) }))
    .filter((item) => item.contours.outer.length || item.contours.inner.length)
  const { placed, width, height } = placeExportItems(
    items,
    gap,
    margin,
    sheetSize,
  )
  const steps = buildProjectExportSteps(
    material,
    materialPanels,
    profiles,
    recipes,
    laserId,
    cutPreset,
    contoursFor,
  )
  const svgGroups = steps
    .map((step) => {
      const shapes = placed.flatMap((item) => {
        if (!step.objectIds.includes(item.panel.id)) return []
        if (step.kind === 'cut-inner')
          return item.contours.inner.map((loop) => ({ loops: [loop], item }))
        if (step.kind === 'cut-outer')
          return item.contours.outer.map((loop) => ({ loops: [loop], item }))
        const assignment = item.panel.processingAssignments?.find(
          (candidate) => candidate.profileId === step.profileId,
        )
        const contours = assignedProfileContours(
          item.panel,
          item.contours,
          step.profileId,
        )
        return assignment?.geometry === 'fill'
          ? [{ loops: [...contours.outer, ...contours.inner], item }]
          : [...contours.outer, ...contours.inner].map((loop) => ({
              loops: [loop],
              item,
            }))
      })
      return `<g id="${escapeXml(step.id)}" inkscape:groupmode="layer" inkscape:label="${escapeXml(`${material.name} ${material.thickness}mm · ${step.name}`)}" data-speed="${step.speed}" data-power="${step.power}" data-passes="${step.passes}" data-air-assist="${step.airAssist}"${step.lineInterval === undefined ? '' : ` data-line-interval="${step.lineInterval}"`}${step.focusOffset === undefined ? '' : ` data-focus-offset="${step.focusOffset}"`}${step.referenceDepth === undefined ? '' : ` data-reference-depth="${step.referenceDepth}"`}>${shapes
        .map(({ loops, item }) => {
          const group = groups.find((candidate) =>
            candidate.panelIds.includes(item.panel.id),
          )
          const objectName = `${group?.name ?? 'Nicht gruppiert'} / ${item.panel.label}`
          const style =
            step.mode === 'fill'
              ? `fill="${step.color}" fill-rule="evenodd" stroke="none"`
              : `fill="none" stroke="${step.color}" stroke-width="0.1" vector-effect="non-scaling-stroke"`
          return `<path id="${escapeXml(`${safeName(item.panel.label)}__${item.panel.id}-${step.id}`)}" inkscape:label="${escapeXml(objectName)}" data-object-id="${escapeXml(item.panel.id)}" d="${loops.map((loop) => path(loop, item.offset)).join(' ')}" ${style} />`
        })
        .join('')}</g>`
    })
    .join('')
  return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}"><metadata>${escapeXml(JSON.stringify({ material, steps }))}</metadata>${svgGroups}</svg>`
}

export function createProfiledMaterialDxf(
  material: MaterialDefinition,
  materialPanels: PanelDefinition[],
  allPanels: PanelDefinition[],
  profiles: ProcessingProfile[],
  recipes: ProcessingRecipe[],
  laserId: string,
  cutPreset?: LaserPreset | CutPresets,
  contoursFor: ContourProvider = extractPanelContours,
  sheetSize?: { width: number; height: number },
) {
  const items = materialPanels
    .filter((panel) => !panel.hidden && panel.visible !== false)
    .map((panel) => ({ panel, contours: contoursFor(panel, allPanels) }))
    .filter((item) => item.contours.outer.length || item.contours.inner.length)
  const { placed, width, height } = placeExportItems(items, 10, 10, sheetSize)
  const steps = buildProjectExportSteps(
    material,
    materialPanels,
    profiles,
    recipes,
    laserId,
    cutPreset,
    contoursFor,
  )
  const dxfLayers = steps.map((step, index) => ({
    name: dxfLayerName(index, step.name),
    color: step.color,
  }))
  const polylines = steps.flatMap((step, index) =>
    placed.flatMap((item): DxfPolyline[] => {
      if (!step.objectIds.includes(item.panel.id)) return []
      const loops =
        step.kind === 'cut-inner'
          ? item.contours.inner
          : step.kind === 'cut-outer'
            ? item.contours.outer
            : [...item.contours.outer, ...item.contours.inner]
      return loops.map((loop) => ({
        layer: dxfLayers[index].name,
        color: step.color,
        loop,
        offset: item.offset,
      }))
    }),
  )
  return createDxf(dxfLayers, polylines, width, height)
}

export function createProfiledMaterialLbrn2(
  material: MaterialDefinition,
  materialPanels: PanelDefinition[],
  allPanels: PanelDefinition[],
  profiles: ProcessingProfile[],
  recipes: ProcessingRecipe[],
  laser: LaserCutterDefinition,
  cutPreset?: LaserPreset | CutPresets,
  contoursFor: ContourProvider = extractPanelContours,
  sheetSize?: { width: number; height: number },
) {
  const items = materialPanels
    .filter((panel) => !panel.hidden && panel.visible !== false)
    .map((panel) => ({ panel, contours: contoursFor(panel, allPanels) }))
    .filter((item) => item.contours.outer.length || item.contours.inner.length)
  const { placed } = placeExportItems(items, 10, 10, sheetSize)
  const steps = buildProjectExportSteps(
    material,
    materialPanels,
    profiles,
    recipes,
    laser.id,
    cutPreset,
    contoursFor,
  )
  const shapes = steps.flatMap((step, cutIndex) =>
    placed.flatMap((item) => {
      if (!step.objectIds.includes(item.panel.id)) return []
      const loops =
        step.kind === 'cut-inner'
          ? item.contours.inner
          : step.kind === 'cut-outer'
            ? item.contours.outer
            : [...item.contours.outer, ...item.contours.inner]
      return loops.map((loop) => ({
        cutIndex,
        loop: loop.map(
          ([x, y]) => [x + item.offset[0], y + item.offset[1]] as Point,
        ),
      }))
    }),
  )
  return createLbrn2Project(shapes, steps, laser.name)
}

export function createMaterialSvg(
  material: MaterialDefinition,
  materialPanels: PanelDefinition[],
  allPanels: PanelDefinition[],
  layers: ExportLayerDefinition[],
  groups: ExportGroupInfo[] = [],
  laserTexts: LaserTextDefinition[] = [],
  sheetSize?: { width: number; height: number },
) {
  const gap = 10,
    margin = 10
  const items = materialPanels
    .filter((panel) => !panel.hidden && panel.visible !== false)
    .map((panel) => ({
      panel,
      contours: extractPanelContours(panel, allPanels),
    }))
    .filter((item) => item.contours.outer.length || item.contours.inner.length)
  const { placed, width, height } = placeExportItems(
    items,
    gap,
    margin,
    sheetSize,
  )
  const materialLayers = layers
    .filter((layer) => layer.materialId === material.id)
    .sort((a, b) => a.order - b.order)
  const svgLayerGroups = materialLayers
    .map((layer) => {
      const loops = !layer.output
        ? []
        : placed.flatMap((item) => {
            const textShape =
              item.panel.shape?.type === 'text' ? item.panel.shape : null
            if (
              textShape &&
              textShape.operation !== 'cut' &&
              layer.operation === textShape.operation
            )
              return [...item.contours.outer, ...item.contours.inner].map(
                (loop) => ({ loop, offset: item.offset, panel: item.panel }),
              )
            if (
              layer.operation === 'cut-inner' &&
              (!textShape || textShape.operation === 'cut')
            )
              return item.contours.inner.map((loop) => ({
                loop,
                offset: item.offset,
                panel: item.panel,
              }))
            if (
              layer.operation === 'cut-outer' &&
              (!textShape || textShape.operation === 'cut')
            )
              return item.contours.outer.map((loop) => ({
                loop,
                offset: item.offset,
                panel: item.panel,
              }))
            return []
          })
      const texts = !layer.output
        ? []
        : placed.flatMap((item) =>
            laserTexts
              .filter(
                (text) =>
                  text.panelId === item.panel.id &&
                  text.operation === layer.operation,
              )
              .map((text) => ({ text, item })),
          )
      return `<g id="${escapeXml(layer.id)}" inkscape:groupmode="layer" inkscape:label="${escapeXml(`${material.name} ${material.thickness}mm · ${layer.name}`)}" data-operation="${layer.operation}" data-speed="${layer.speed}" data-power="${layer.power}" data-passes="${layer.passes}" data-air-assist="${layer.airAssist}" data-output="${layer.output}">${loops
        .map(({ loop, offset, panel }) => {
          const group = groups.find((candidate) =>
            candidate.panelIds.includes(panel.id),
          )
          const groupName = group?.name ?? 'Nicht gruppiert'
          const objectName = `${groupName} / ${panel.label}`
          const style =
            layer.operation === 'engrave-fill'
              ? `fill="${layer.color}" fill-rule="evenodd" stroke="none"`
              : `fill="none" stroke="${layer.color}" stroke-width="0.1" vector-effect="non-scaling-stroke"`
          return `<path id="${escapeXml(`${safeName(groupName)}__${safeName(panel.label)}__${panel.id}-${layer.operation}`)}" inkscape:label="${escapeXml(objectName)}" data-group-id="${escapeXml(group?.id ?? '')}" data-group="${escapeXml(groupName)}" data-object-id="${escapeXml(panel.id)}" data-object="${escapeXml(panel.label)}" d="${path(loop, offset)}" ${style} />`
        })
        .join('')}${texts
        .map(({ text, item }) => {
          const x = item.offset[0] + text.position[0] - item.contours.minX
          const y = item.offset[1] + item.contours.maxY - text.position[1]
          const style =
            layer.operation === 'engrave-fill'
              ? `fill="${layer.color}" stroke="none"`
              : `fill="none" stroke="${layer.color}" stroke-width="0.1"`
          return `<text id="${escapeXml(`${text.id}-${layer.operation}`)}" x="${x.toFixed(3)}" y="${y.toFixed(3)}" font-family="${escapeXml(text.fontFamily)}" font-size="${text.fontSize.toFixed(3)}" text-anchor="middle" dominant-baseline="central" transform="rotate(${-text.rotation} ${x.toFixed(3)} ${y.toFixed(3)})" ${style} data-font-family="${escapeXml(text.fontFamily)}" data-object-id="${escapeXml(item.panel.id)}">${escapeXml(text.text)}</text>`
        })
        .join('')}</g>`
    })
    .join('')
  return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}"><metadata>${escapeXml(JSON.stringify({ material, layers: materialLayers }))}</metadata>${svgLayerGroups}</svg>`
}

export function createMaterialDxf(
  material: MaterialDefinition,
  materialPanels: PanelDefinition[],
  allPanels: PanelDefinition[],
  layers: ExportLayerDefinition[],
  contoursFor: ContourProvider = extractPanelContours,
  sheetSize?: { width: number; height: number },
) {
  const items = materialPanels
    .filter((panel) => !panel.hidden && panel.visible !== false)
    .map((panel) => ({ panel, contours: contoursFor(panel, allPanels) }))
    .filter((item) => item.contours.outer.length || item.contours.inner.length)
  const { placed, width, height } = placeExportItems(items, 10, 10, sheetSize)
  const materialLayers = layers
    .filter((layer) => layer.materialId === material.id && layer.output)
    .sort((a, b) => a.order - b.order)
  const dxfLayers = materialLayers.map((layer, index) => ({
    name: dxfLayerName(index, layer.name),
    color: layer.color,
  }))
  const polylines = materialLayers.flatMap((layer, index) =>
    placed.flatMap((item): DxfPolyline[] => {
      const textShape =
        item.panel.shape?.type === 'text' ? item.panel.shape : null
      const loops =
        textShape &&
        textShape.operation !== 'cut' &&
        layer.operation === textShape.operation
          ? [...item.contours.outer, ...item.contours.inner]
          : layer.operation === 'cut-inner' &&
              (!textShape || textShape.operation === 'cut')
            ? item.contours.inner
            : layer.operation === 'cut-outer' &&
                (!textShape || textShape.operation === 'cut')
              ? item.contours.outer
              : []
      return loops.map((loop) => ({
        layer: dxfLayers[index].name,
        color: layer.color,
        loop,
        offset: item.offset,
      }))
    }),
  )
  return createDxf(dxfLayers, polylines, width, height)
}

export async function createExportPackage(
  materials: MaterialDefinition[],
  panels: PanelDefinition[],
  layers: ExportLayerDefinition[],
  laser?: LaserCutterDefinition,
  presets: LaserPreset[] = [],
  groups: ExportGroupInfo[] = [],
  laserTexts: LaserTextDefinition[] = [],
  processingProfiles?: ProcessingProfile[],
  processingRecipes: ProcessingRecipe[] = [],
  contoursFor: ContourProvider = extractPanelContours,
) {
  const zip = new JSZip()
  const usedMaterials = materials.filter((material) =>
    panels.some(
      (panel) =>
        !panel.hidden &&
        panel.visible !== false &&
        panel.materialId === material.id,
    ),
  )
  const generatedFiles: string[] = []
  for (const material of usedMaterials) {
    const materialPanels = panels.filter(
      (panel) => panel.materialId === material.id,
    )
    const cutPreset = {
      inner: presets.find(
        (preset) =>
          preset.laserId === laser?.id &&
          preset.materialId === material.id &&
          preset.operation === 'cut-inner',
      ),
      outer: presets.find(
        (preset) =>
          preset.laserId === laser?.id &&
          preset.materialId === material.id &&
          preset.operation === 'cut-outer',
      ),
    }
    const profiled = Boolean(processingProfiles && laser)
    const sheets = laser
      ? splitPanelsIntoSheets(
          materialPanels,
          panels,
          laser.bedWidth ?? 400,
          laser.bedHeight ?? 400,
          contoursFor,
        )
      : [materialPanels]
    for (const [sheetIndex, sheetPanels] of sheets.entries()) {
      const sheetSize = laser
        ? { width: laser.bedWidth ?? 400, height: laser.bedHeight ?? 400 }
        : undefined
      const sheetSuffix = sheets.length > 1 ? `_Blatt_${sheetIndex + 1}` : ''
      const baseName = `${safeName(material.name)}_${material.thickness}mm${sheetSuffix}`
      const svgName = `${baseName}.svg`
      const dxfName = `${baseName}.dxf`
      zip.file(
        svgName,
        profiled
          ? createProfiledMaterialSvg(
              material,
              sheetPanels,
              panels,
              processingProfiles!,
              processingRecipes,
              laser!.id,
              cutPreset,
              groups,
              contoursFor,
              sheetSize,
            )
          : createMaterialSvg(
              material,
              sheetPanels,
              panels,
              layers,
              groups,
              laserTexts,
              sheetSize,
            ),
      )
      zip.file(
        dxfName,
        profiled
          ? createProfiledMaterialDxf(
              material,
              sheetPanels,
              panels,
              processingProfiles!,
              processingRecipes,
              laser!.id,
              cutPreset,
              contoursFor,
              sheetSize,
            )
          : createMaterialDxf(
              material,
              sheetPanels,
              panels,
              layers,
              contoursFor,
              sheetSize,
            ),
      )
      generatedFiles.push(svgName, dxfName)
      if (profiled) {
        const lbrnName = `${baseName}.lbrn2`
        zip.file(
          lbrnName,
          createProfiledMaterialLbrn2(
            material,
            sheetPanels,
            panels,
            processingProfiles!,
            processingRecipes,
            laser!,
            cutPreset,
            contoursFor,
            sheetSize,
          ),
        )
        generatedFiles.push(lbrnName)
      }
    }
  }
  const parts = panels
    .filter((panel) => !panel.hidden)
    .map((panel) => {
      const group = groups.find((candidate) =>
        candidate.panelIds.includes(panel.id),
      )
      return {
        id: panel.id,
        name: panel.label,
        groupId: group?.id ?? null,
        groupName: group?.name ?? 'Nicht gruppiert',
        qualifiedName: `${group?.name ?? 'Nicht gruppiert'} / ${panel.label}`,
        materialId: panel.materialId ?? null,
      }
    })
  const projectSteps =
    processingProfiles && laser
      ? usedMaterials.flatMap((material) =>
          buildProjectExportSteps(
            material,
            panels,
            processingProfiles,
            processingRecipes,
            laser.id,
            {
              inner: presets.find(
                (preset) =>
                  preset.laserId === laser.id &&
                  preset.materialId === material.id &&
                  preset.operation === 'cut-inner',
              ),
              outer: presets.find(
                (preset) =>
                  preset.laserId === laser.id &&
                  preset.materialId === material.id &&
                  preset.operation === 'cut-outer',
              ),
            },
            contoursFor,
          ),
        )
      : undefined
  zip.file(
    'export-manifest.json',
    JSON.stringify(
      {
        format: 'lasercut-studio-export',
        version: 5,
        createdAt: new Date().toISOString(),
        laser: laser ?? null,
        materials: usedMaterials,
        parts,
        texts: laserTexts,
        fonts: [...new Set(laserTexts.map((text) => text.fontFamily))].sort(),
        layers: projectSteps ?? layers.sort((a, b) => a.order - b.order),
        profiles:
          processingProfiles?.filter((profile) =>
            projectSteps?.some((step) => step.profileId === profile.id),
          ) ?? [],
        recipes: laser
          ? processingRecipes.filter(
              (recipe) =>
                recipe.laserId === laser.id &&
                usedMaterials.some(
                  (material) => material.id === recipe.materialId,
                ),
            )
          : [],
        presets: laser
          ? presets.filter(
              (preset) =>
                preset.laserId === laser.id &&
                usedMaterials.some(
                  (material) => material.id === preset.materialId,
                ),
            )
          : [],
        files: generatedFiles,
      },
      null,
      2,
    ),
  )
  zip.file(
    'README.txt',
    'LaserCut Studio Export\n\nBearbeitungsreihenfolge: Gravur, Markierung, Innenschnitt, Außenschnitt.\nLBRN2 enthält Geometrie, Bearbeitungsreihenfolge und Laserparameter als direkt öffnbares LightBurn-Projekt. SVG- und DXF-Farben bilden LightBurn-Layer. Die DXF-Dateien verwenden Millimeter und geschlossene Polylinien; flächige Bearbeitungen werden als geschlossene Konturen übertragen. Laserparameter stehen außerdem im Manifest und in den SVG-Layer-Metadaten. Vor dem Start Einstellungen und Vorschau in LightBurn prüfen.\n',
  )
  return zip.generateAsync({ type: 'blob' })
}
