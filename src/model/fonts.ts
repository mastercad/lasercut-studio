import * as opentype from 'opentype.js'
import type { TextOutline, TextPathCommand } from './box'
import bundledFontData from 'three/examples/fonts/helvetiker_regular.typeface.json'
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js'

const commonFonts = [
  'Arial',
  'Arial Black',
  'Calibri',
  'Cambria',
  'Courier New',
  'Georgia',
  'Helvetica',
  'Impact',
  'Tahoma',
  'Times New Roman',
  'Trebuchet MS',
  'Verdana',
]
export const bundledFontFamily = 'LaserCut Sans'
type LocalFontData = {
  family: string
  fullName: string
  postscriptName: string
  blob: () => Promise<Blob>
}
const localFontData = new Map<string, LocalFontData>()
const bundledFont = new FontLoader().parse(bundledFontData)

const outlineFromFont = (
  font: opentype.Font,
  text: string,
  fontSize: number,
): TextOutline | null => {
  if (!text) return null
  const path = font.getPath(text, 0, 0, fontSize)
  const bounds = path.getBoundingBox()
  const width = Math.max(0.1, bounds.x2 - bounds.x1),
    height = Math.max(0.1, bounds.y2 - bounds.y1)
  const commands = path.commands.map((command) => {
    if (command.type === 'Z') return { type: 'Z' } as TextPathCommand
    if (command.type === 'C')
      return {
        type: 'C',
        x: command.x!,
        y: -command.y!,
        x1: command.x1!,
        y1: -command.y1!,
        x2: command.x2!,
        y2: -command.y2!,
      } as TextPathCommand
    if (command.type === 'Q')
      return {
        type: 'Q',
        x: command.x!,
        y: -command.y!,
        x1: command.x1!,
        y1: -command.y1!,
      } as TextPathCommand
    return {
      type: command.type as 'M' | 'L',
      x: command.x!,
      y: -command.y!,
    } as TextPathCommand
  })
  return {
    commands,
    width,
    height,
    centerX: (bounds.x1 + bounds.x2) / 2,
    centerY: -(bounds.y1 + bounds.y2) / 2,
  }
}

export async function createBundledTextOutline(text: string, fontSize: number) {
  if (!text) return null
  const shapes = bundledFont.generateShapes(text, fontSize)
  const commands: TextPathCommand[] = []
  const paths = shapes.flatMap((shape) => [shape, ...shape.holes])
  paths.forEach((path) => {
    const start = path.getPoint(0)
    commands.push({ type: 'M', x: start.x, y: start.y })
    path.curves.forEach((curve) => {
      const item = curve as unknown as {
        type: string
        v1: { x: number; y: number }
        v2: { x: number; y: number }
        v3?: { x: number; y: number }
      }
      if (item.type === 'LineCurve')
        commands.push({ type: 'L', x: item.v2.x, y: item.v2.y })
      else if (item.type === 'QuadraticBezierCurve')
        commands.push({
          type: 'Q',
          x: item.v2.x,
          y: item.v2.y,
          x1: item.v1.x,
          y1: item.v1.y,
        })
      else if (item.type === 'CubicBezierCurve' && item.v3)
        commands.push({
          type: 'C',
          x: item.v3.x,
          y: item.v3.y,
          x1: item.v1.x,
          y1: item.v1.y,
          x2: item.v2.x,
          y2: item.v2.y,
        })
    })
    commands.push({ type: 'Z' })
  })
  const points = paths.flatMap((path) => path.getPoints(16))
  if (!points.length) return null
  const minX = Math.min(...points.map((point) => point.x)),
    maxX = Math.max(...points.map((point) => point.x))
  const minY = Math.min(...points.map((point) => point.y)),
    maxY = Math.max(...points.map((point) => point.y))
  return {
    commands,
    width: Math.max(0.1, maxX - minX),
    height: Math.max(0.1, maxY - minY),
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
  }
}

export function isFontAvailable(fontFamily: string) {
  if (typeof document === 'undefined') return true
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) return true
  const sample = 'mmmmmmmmmmlliWW@#0123456789'
  return ['monospace', 'serif', 'sans-serif'].some((fallback) => {
    context.font = `72px ${fallback}`
    const fallbackWidth = context.measureText(sample).width
    context.font = `72px "${fontFamily.replace(/"/g, '')}", ${fallback}`
    return Math.abs(context.measureText(sample).width - fallbackWidth) > 0.1
  })
}

export function availableCommonFonts() {
  return commonFonts.filter(isFontAvailable)
}

export async function listInstalledSystemFonts() {
  if (typeof window === 'undefined') return []
  const queryLocalFonts = (
    window as unknown as { queryLocalFonts?: () => Promise<LocalFontData[]> }
  ).queryLocalFonts
  if (!queryLocalFonts) return []
  try {
    const fonts = await queryLocalFonts.call(window)
    localFontData.clear()
    fonts.forEach((font) => {
      if (!localFontData.has(font.family)) localFontData.set(font.family, font)
    })
    return [...new Set(fonts.map((font) => font.family))].sort((a, b) =>
      a.localeCompare(b),
    )
  } catch {
    return []
  }
}

export async function createSystemTextOutline(
  fontFamily: string,
  text: string,
  fontSize: number,
): Promise<TextOutline | null> {
  if (fontFamily === bundledFontFamily)
    return createBundledTextOutline(text, fontSize)
  const localFont = localFontData.get(fontFamily)
  if (!localFont || !text) return null
  const font = opentype.parse(await (await localFont.blob()).arrayBuffer())
  return outlineFromFont(font, text, fontSize)
}

export function missingFontFamilies(fontFamilies: string[]) {
  return [...new Set(fontFamilies)]
    .filter((font) => font !== bundledFontFamily && !isFontAvailable(font))
    .sort()
}
