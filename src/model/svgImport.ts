import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js'
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
    const name = labelOf(node, `Form ${pathIndex + 1}`)
    const groupNode = node?.parentElement?.closest('g') ?? undefined
    const groupName = labelOf(groupNode, fileName.replace(/\.svg$/i, ''))
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
