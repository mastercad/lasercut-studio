import JSZip from 'jszip'
import type { BufferGeometry } from 'three'
import {
  thinAxis,
  type LaserTextDefinition,
  type MaterialDefinition,
  type PanelDefinition,
} from './box'
import { createEvaluatedPanelGeometry } from './panelGeometry'

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
  passes: number
  airAssist: boolean
  output: boolean
  order: number
}
export type LaserCutterDefinition = {
  id: string
  name: string
  powerWatts: number
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
}
export type ExportGroupInfo = { id: string; name: string; panelIds: string[] }
export const defaultLaserCutters: LaserCutterDefinition[] = [
  {
    id: 'generic-10w',
    name: 'Generischer Diodenlaser',
    powerWatts: 10,
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
const safeName = (value: string) =>
  value
    .normalize('NFKD')
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
  passes: number
  airAssist: boolean
  objectIds: string[]
  contourCount: number
  profileId?: string
  referenceDepth?: number
  lineInterval?: number
  focusOffset?: number
  configured: boolean
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
        passes: recipe?.passes ?? 0,
        airAssist: recipe?.airAssist ?? false,
        configured: Boolean(recipe),
        referenceDepth: profile.referenceDepth,
        lineInterval: recipe?.lineInterval,
        focusOffset: recipe?.focusOffset,
        objectIds: assigned.map(({ panel }) => panel.id),
        contourCount: assigned.reduce((sum, { panel, contours }) => {
          const assignment = panel.processingAssignments?.find(
            (candidate) => candidate.profileId === profile.id,
          )
          return (
            sum +
            (assignment?.geometry === 'fill'
              ? contours.outer.length
              : contours.outer.length + contours.inner.length)
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
) {
  const gap = 10,
    margin = 10
  const items = materialPanels
    .filter((panel) => !panel.hidden && panel.visible !== false)
    .map((panel) => ({ panel, contours: contoursFor(panel, allPanels) }))
    .filter((item) => item.contours.outer.length || item.contours.inner.length)
  let cursorX = margin
  const placed = items.map((item) => {
    const offset: Point = [cursorX, margin]
    cursorX += item.contours.width + gap
    return { ...item, offset }
  })
  const width = Math.max(20, cursorX - gap + margin),
    height = Math.max(
      20,
      ...placed.map((item) => item.contours.height + margin * 2),
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
        return assignment?.geometry === 'fill'
          ? [{ loops: [...item.contours.outer, ...item.contours.inner], item }]
          : [...item.contours.outer, ...item.contours.inner].map((loop) => ({
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

export function createMaterialSvg(
  material: MaterialDefinition,
  materialPanels: PanelDefinition[],
  allPanels: PanelDefinition[],
  layers: ExportLayerDefinition[],
  groups: ExportGroupInfo[] = [],
  laserTexts: LaserTextDefinition[] = [],
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
  let cursorX = margin
  const placed = items.map((item) => {
    const offset: Point = [cursorX, margin]
    cursorX += item.contours.width + gap
    return { ...item, offset }
  })
  const width = Math.max(20, cursorX - gap + margin),
    height = Math.max(
      20,
      ...placed.map((item) => item.contours.height + margin * 2),
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
    zip.file(
      `${safeName(material.name)}_${material.thickness}mm.svg`,
      processingProfiles && laser
        ? createProfiledMaterialSvg(
            material,
            materialPanels,
            panels,
            processingProfiles,
            processingRecipes,
            laser.id,
            cutPreset,
            groups,
            contoursFor,
          )
        : createMaterialSvg(
            material,
            materialPanels,
            panels,
            layers,
            groups,
            laserTexts,
          ),
    )
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
        version: 3,
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
        files: usedMaterials.map(
          (material) =>
            `${safeName(material.name)}_${material.thickness}mm.svg`,
        ),
      },
      null,
      2,
    ),
  )
  zip.file(
    'README.txt',
    'LaserCut Studio Export\n\nBearbeitungsreihenfolge: Gravur, Markierung, Innenschnitt, Außenschnitt.\nSVG-Farben bilden LightBurn-Layer. Laserparameter stehen zusätzlich im Manifest und in den SVG-Layer-Metadaten. Vor dem Start Einstellungen und Vorschau in LightBurn prüfen.\n',
  )
  return zip.generateAsync({ type: 'blob' })
}
