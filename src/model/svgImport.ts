import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js'
import { convertLbrn2ToSvg, type Lbrn2CutSetting } from './lbrn2'
import { convertDxfToSvg } from './dxfImport'
import type { ContourFace, ContourPoint } from './box'

export type SvgImportWarning = {
  kind: 'warning' | 'error'
  message: string
  objectName?: string
}
export type SvgImportObject = {
  id: string
  name: string
  groupName: string
  color: string | null
  faces: ContourFace[]
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
  sourceLayer?: string
  sourceCutIndex?: number
  sourceOperation?: string
  sourceShapeType?: string
  recommendedInclude?: boolean
  attachedOperations?: SvgImportOperation[]
}
export type SvgImportOperation = {
  id: string
  name: string
  operation: string
  shapeType?: string
  sourceCutIndex?: number
  faces: ContourFace[]
}
export type SvgImportDocument = {
  fileName: string
  objects: SvgImportObject[]
  warnings: SvgImportWarning[]
  sourceWidth: number
  sourceHeight: number
  widthMm: number
  heightMm: number
  hasReliableSize: boolean
  sourceFormat?: 'svg' | 'dxf' | 'lbrn' | 'lbrn2'
  convertedSvg?: string
  lightBurn?: {
    appVersion: string
    deviceName: string
    cutSettings: Lbrn2CutSetting[]
  }
  estimatedThickness?: {
    mm: number
    confidence: 'hoch' | 'mittel'
    evidenceCount: number
  }
}

const area = (ring: ContourPoint[]) =>
  Math.abs(
    ring.reduce((sum, point, index) => {
      const next = ring[(index + 1) % ring.length]
      return sum + point[0] * next[1] - next[0] * point[1]
    }, 0) / 2,
  )

const cleanRing = (points: { x: number; y: number }[]): ContourPoint[] => {
  const result = points.map((point) => [point.x, -point.y] as ContourPoint)
  if (
    result.length > 1 &&
    Math.hypot(
      result[0][0] - result.at(-1)![0],
      result[0][1] - result.at(-1)![1],
    ) < 1e-6
  )
    result.pop()
  return result.filter(
    (point, index) =>
      !index ||
      Math.hypot(
        point[0] - result[index - 1][0],
        point[1] - result[index - 1][1],
      ) > 1e-6,
  )
}

const lengthInMm = (value: string | null): number | null => {
  if (!value) return null
  const match = value.trim().match(/^([\d.+-]+)\s*(mm|cm|in|pt|pc|px)?$/i)
  if (!match) return null
  const number = Number(match[1])
  if (!Number.isFinite(number) || number <= 0) return null
  const factors: Record<string, number> = {
    mm: 1,
    cm: 10,
    in: 25.4,
    pt: 25.4 / 72,
    pc: 25.4 / 6,
    px: 25.4 / 96,
  }
  return number * (factors[(match[2] || '').toLowerCase()] ?? 1)
}

const colorOf = (value: unknown) => {
  if (
    typeof value !== 'string' ||
    !value ||
    value === 'none' ||
    value === 'transparent'
  )
    return null
  const rgb = value.match(/^rgb\(\s*(\d+)\D+(\d+)\D+(\d+)\s*\)$/i)
  if (rgb)
    return `#${rgb
      .slice(1)
      .map((part) => Number(part).toString(16).padStart(2, '0'))
      .join('')}`
  return value.startsWith('#') ? value : null
}

const labelOf = (node: Element | undefined, fallback: string) =>
  node?.getAttribute('aria-label') ||
  node?.getAttribute('inkscape:label') ||
  node?.getAttribute('data-name') ||
  node?.getAttribute('id') ||
  fallback

export function parseSvgImport(
  contents: string,
  fileName = 'Vorlage.svg',
): SvgImportDocument {
  if (typeof DOMParser === 'undefined')
    throw new Error(
      'SVG-Dateien können in dieser Umgebung nicht gelesen werden.',
    )
  const xml = new DOMParser().parseFromString(contents, 'image/svg+xml')
  const parseError = xml.querySelector('parsererror')
  if (parseError)
    throw new Error('Die SVG-Datei ist beschädigt oder nicht vollständig.')
  const root = xml.documentElement
  if (root.tagName.toLowerCase() !== 'svg')
    throw new Error('Die ausgewählte Datei ist keine SVG-Datei.')
  const viewBox = (root.getAttribute('viewBox') || '')
    .trim()
    .split(/[\s,]+/)
    .map(Number)
  const viewWidth =
    viewBox.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0
      ? viewBox[2]
      : Number(root.getAttribute('width')) || 0
  const viewHeight =
    viewBox.length === 4 && viewBox.every(Number.isFinite) && viewBox[3] > 0
      ? viewBox[3]
      : Number(root.getAttribute('height')) || 0
  const physicalWidth = lengthInMm(root.getAttribute('width'))
  const physicalHeight = lengthInMm(root.getAttribute('height'))
  const widthHasUnit = /(?:mm|cm|in|pt|pc|px)\s*$/i.test(
    root.getAttribute('width') || '',
  )
  const heightHasUnit = /(?:mm|cm|in|pt|pc|px)\s*$/i.test(
    root.getAttribute('height') || '',
  )
  const hasReliableSize = Boolean(
    viewWidth &&
    viewHeight &&
    physicalWidth &&
    physicalHeight &&
    widthHasUnit &&
    heightHasUnit,
  )
  const loaderResult = new SVGLoader().parse(contents)
  const warnings: SvgImportWarning[] = []
  const objects: SvgImportObject[] = []

  loaderResult.paths.forEach((path, pathIndex) => {
    const node = path.userData?.node as Element | undefined
    const layerName = node?.getAttribute('data-layer') || ''
    const cutIndex = node?.getAttribute('data-cut-index')
    const sourceOperation = node?.getAttribute('data-operation') || undefined
    const sourceShapeType = node?.getAttribute('data-shape-type') || undefined
    const fallbackName = layerName
      ? `${layerName} · Form ${pathIndex + 1}`
      : `Form ${pathIndex + 1}`
    const name = labelOf(node, fallbackName)
    const groupNode = node?.parentElement?.closest('g') ?? undefined
    const groupName = layerName
      ? `${layerName}${cutIndex != null ? ` (C${cutIndex.padStart(2, '0')})` : ''}`
      : labelOf(groupNode, fileName.replace(/\.svg$/i, ''))
    const style = path.userData?.style as Record<string, unknown> | undefined
    const fill = style?.fill ?? node?.getAttribute('fill')
    const stroke = style?.stroke ?? node?.getAttribute('stroke')
    const subPaths = path.subPaths.map((subPath) => subPath.getPoints(24))
    const hasOpenPath = subPaths.some(
      (points) =>
        points.length < 3 ||
        Math.hypot(
          points[0].x - points.at(-1)!.x,
          points[0].y - points.at(-1)!.y,
        ) > 1e-4,
    )
    if (hasOpenPath) {
      warnings.push({
        kind: 'warning',
        objectName: name,
        message: `„${name}“ ist eine offene Linie und wird nicht als Materialteil importiert.`,
      })
      return
    }
    const clockwise = path.toShapes(false)
    const counterClockwise = path.toShapes(true)
    const score = (items: typeof clockwise) =>
      items.reduce(
        (sum, shape) =>
          sum +
          area(cleanRing(shape.getPoints(24))) -
          shape.holes.reduce(
            (holes, hole) => holes + area(cleanRing(hole.getPoints(24))),
            0,
          ),
        0,
      )
    const shapes =
      score(counterClockwise) > score(clockwise) ? counterClockwise : clockwise
    const faces: ContourFace[] = shapes
      .map((shape, index) => ({
        id: `face-${index}`,
        outer: cleanRing(shape.getPoints(24)),
        holes: shape.holes.map((hole) => cleanRing(hole.getPoints(24))),
      }))
      .filter((face) => face.outer.length >= 3 && area(face.outer) > 1e-6)
    if (!faces.length) {
      warnings.push({
        kind: 'warning',
        objectName: name,
        message: `„${name}“ enthält keine verwendbare geschlossene Fläche.`,
      })
      return
    }
    const points = faces.flatMap((face) => [face.outer, ...face.holes]).flat()
    objects.push({
      id: `svg-object-${pathIndex}`,
      name,
      groupName,
      color: colorOf(fill) ?? colorOf(stroke),
      faces,
      bounds: {
        minX: Math.min(...points.map((point) => point[0])),
        minY: Math.min(...points.map((point) => point[1])),
        maxX: Math.max(...points.map((point) => point[0])),
        maxY: Math.max(...points.map((point) => point[1])),
      },
      sourceLayer: layerName || undefined,
      sourceCutIndex:
        cutIndex != null && Number.isFinite(Number(cutIndex))
          ? Number(cutIndex)
          : undefined,
      sourceOperation,
      sourceShapeType,
    })
  })

  if (!objects.length)
    warnings.push({
      kind: 'error',
      message: 'Es wurden keine geschlossenen, gefüllten Formen gefunden.',
    })
  const allPoints = objects.flatMap((object) =>
    object.faces.flatMap((face) => [face.outer, ...face.holes]).flat(),
  )
  const contentWidth = allPoints.length
    ? Math.max(...allPoints.map((point) => point[0])) -
      Math.min(...allPoints.map((point) => point[0]))
    : viewWidth || 100
  const contentHeight = allPoints.length
    ? Math.max(...allPoints.map((point) => point[1])) -
      Math.min(...allPoints.map((point) => point[1]))
    : viewHeight || 100
  const ratioScale =
    physicalWidth && viewWidth
      ? physicalWidth / viewWidth
      : physicalHeight && viewHeight
        ? physicalHeight / viewHeight
        : 1
  if (!hasReliableSize)
    warnings.unshift({
      kind: 'warning',
      message:
        'Die SVG enthält keine eindeutige Größe in Millimetern. Bitte Breite und Höhe vor dem Import prüfen.',
    })
  return {
    fileName,
    objects,
    warnings,
    sourceWidth: contentWidth,
    sourceHeight: contentHeight,
    widthMm: contentWidth * ratioScale,
    heightMm: contentHeight * ratioScale,
    hasReliableSize,
  }
}

const boundsArea = (object: SvgImportObject) =>
  (object.bounds.maxX - object.bounds.minX) *
  (object.bounds.maxY - object.bounds.minY)

const containsCenter = (
  container: SvgImportObject,
  candidate: SvgImportObject,
) => {
  const x = (candidate.bounds.minX + candidate.bounds.maxX) / 2
  const y = (candidate.bounds.minY + candidate.bounds.maxY) / 2
  return (
    x >= container.bounds.minX &&
    x <= container.bounds.maxX &&
    y >= container.bounds.minY &&
    y <= container.bounds.maxY
  )
}

function estimateFingerThickness(objects: SvgImportObject[]) {
  const counts = new Map<number, number>()
  for (const object of objects) {
    const width = object.bounds.maxX - object.bounds.minX
    const height = object.bounds.maxY - object.bounds.minY
    if (width < 20 || height < 20) continue
    for (const face of object.faces)
      face.outer.forEach((point, index) => {
        const next = face.outer[(index + 1) % face.outer.length]
        const dx = Math.abs(next[0] - point[0])
        const dy = Math.abs(next[1] - point[1])
        const length = dx < 0.02 ? dy : dy < 0.02 ? dx : 0
        if (length < 1 || length > 12) return
        const bucket = Math.round(length * 10) / 10
        counts.set(bucket, (counts.get(bucket) ?? 0) + 1)
      })
  }
  const best = [...counts].sort(
    ([firstLength, firstCount], [secondLength, secondCount]) =>
      secondCount - firstCount || firstLength - secondLength,
  )[0]
  if (!best || best[1] < 4) return undefined
  return {
    mm: best[0],
    confidence: best[1] >= 8 ? ('hoch' as const) : ('mittel' as const),
    evidenceCount: best[1],
  }
}

function prepareLightBurnObjects(objects: SvgImportObject[]) {
  const prepared = objects.map((object) => ({ ...object }))
  const materialParts = prepared.filter(
    (object) =>
      object.sourceOperation?.toLowerCase() === 'cut' &&
      object.sourceShapeType !== 'Text',
  )
  for (const object of prepared) {
    object.recommendedInclude = materialParts.includes(object)
    if (object.recommendedInclude) object.attachedOperations = []
  }
  const operations = prepared.filter(
    (object) => !materialParts.includes(object),
  )
  let attachedOperationCount = 0
  for (const operation of operations) {
    const target = materialParts
      .filter((part) => containsCenter(part, operation))
      .sort((first, second) => boundsArea(first) - boundsArea(second))[0]
    if (!target) continue
    target.attachedOperations!.push({
      id: operation.id,
      name: operation.name,
      operation: operation.sourceOperation ?? 'Unbekannt',
      shapeType: operation.sourceShapeType,
      sourceCutIndex: operation.sourceCutIndex,
      faces: operation.faces,
    })
    attachedOperationCount += 1
  }
  return {
    objects: prepared,
    estimatedThickness: estimateFingerThickness(materialParts),
    attachedOperationCount,
    unattachedOperationCount: operations.length - attachedOperationCount,
  }
}

export function parseLbrn2Import(
  contents: string,
  fileName = 'LightBurn-Projekt.lbrn2',
): SvgImportDocument {
  const conversion = convertLbrn2ToSvg(contents)
  const parsed = parseSvgImport(
    conversion.svg,
    fileName.replace(/\.lbrn2$/i, '.svg'),
  )
  const prepared = prepareLightBurnObjects(parsed.objects)
  return {
    ...parsed,
    objects: prepared.objects,
    fileName,
    sourceFormat: 'lbrn2',
    convertedSvg: conversion.svg,
    lightBurn: {
      appVersion: conversion.appVersion,
      deviceName: conversion.deviceName,
      cutSettings: conversion.cutSettings,
    },
    estimatedThickness: prepared.estimatedThickness,
    warnings: [
      ...(prepared.attachedOperationCount
        ? [
            {
              kind: 'warning' as const,
              message: `${prepared.attachedOperationCount} Gravur- oder Textobjekt${prepared.attachedOperationCount === 1 ? '' : 'e'} wurden den zugehörigen Bauteilen als Bearbeitungen zugeordnet.`,
            },
          ]
        : []),
      ...(prepared.unattachedOperationCount
        ? [
            {
              kind: 'warning' as const,
              message: `${prepared.unattachedOperationCount} Gravur- oder Textobjekt${prepared.unattachedOperationCount === 1 ? '' : 'e'} konnte keinem Bauteil eindeutig zugeordnet werden und bleibt zur manuellen Kontrolle sichtbar.`,
            },
          ]
        : []),
      ...conversion.warnings.map((message) => ({
        kind: 'warning' as const,
        message,
      })),
      ...parsed.warnings,
    ],
  }
}

export function parseLbrnImport(
  contents: string,
  fileName = 'LightBurn-Projekt.lbrn',
): SvgImportDocument {
  const conversion = convertLbrn2ToSvg(contents)
  const parsed = parseSvgImport(
    conversion.svg,
    fileName.replace(/\.lbrn$/i, '.svg'),
  )
  const prepared = prepareLightBurnObjects(parsed.objects)
  return {
    ...parsed,
    objects: prepared.objects,
    fileName,
    sourceFormat: 'lbrn',
    convertedSvg: conversion.svg,
    lightBurn: {
      appVersion: conversion.appVersion,
      deviceName: conversion.deviceName,
      cutSettings: conversion.cutSettings,
    },
    estimatedThickness: prepared.estimatedThickness,
    warnings: [
      ...(prepared.attachedOperationCount
        ? [
            {
              kind: 'warning' as const,
              message: `${prepared.attachedOperationCount} Gravur- oder Textobjekt${prepared.attachedOperationCount === 1 ? '' : 'e'} wurden den zugehörigen Bauteilen als Bearbeitungen zugeordnet.`,
            },
          ]
        : []),
      ...(prepared.unattachedOperationCount
        ? [
            {
              kind: 'warning' as const,
              message: `${prepared.unattachedOperationCount} Gravur- oder Textobjekt${prepared.unattachedOperationCount === 1 ? '' : 'e'} konnte keinem Bauteil eindeutig zugeordnet werden und bleibt zur manuellen Kontrolle sichtbar.`,
            },
          ]
        : []),
      ...conversion.warnings.map((message) => ({
        kind: 'warning' as const,
        message,
      })),
      ...parsed.warnings,
    ],
  }
}

export function parseDxfImport(
  contents: string,
  fileName = 'Zeichnung.dxf',
): SvgImportDocument {
  const conversion = convertDxfToSvg(contents)
  const parsed = parseSvgImport(
    conversion.svg,
    fileName.replace(/\.dxf$/i, '.svg'),
  )
  return {
    ...parsed,
    fileName,
    sourceFormat: 'dxf',
    convertedSvg: conversion.svg,
    hasReliableSize: conversion.hasReliableSize,
    warnings: [
      ...(!conversion.hasReliableSize
        ? [
            {
              kind: 'warning' as const,
              message:
                'Die DXF-Datei enthält keine eindeutige Einheit. Bitte Breite und Höhe vor dem Import prüfen.',
            },
          ]
        : []),
      ...conversion.warnings.map((message) => ({
        kind: 'warning' as const,
        message,
      })),
      ...parsed.warnings.filter(
        (warning) =>
          conversion.hasReliableSize ||
          !warning.message.startsWith('Die SVG enthält keine eindeutige Größe'),
      ),
    ],
  }
}
