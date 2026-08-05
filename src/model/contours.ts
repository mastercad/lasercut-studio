import { Path, Shape, ShapePath } from 'three'
import {
  thinAxis,
  type ContourFace,
  type ContourPoint,
  type PanelDefinition,
  type PanelShape,
  type TextOutline,
} from './box'

const polygon = (
  count: number,
  radiusX: number,
  radiusY: number,
  phase = Math.PI / 2,
): ContourPoint[] =>
  Array.from({ length: count }, (_, index) => {
    const angle = phase + (index * Math.PI * 2) / count
    return [Math.cos(angle) * radiusX, Math.sin(angle) * radiusY]
  })

export function textOutlineShapes(outline: TextOutline) {
  const path = new ShapePath()
  for (const command of outline.commands) {
    if (command.type === 'M')
      path.moveTo(command.x - outline.centerX, command.y - outline.centerY)
    else if (command.type === 'L')
      path.lineTo(command.x - outline.centerX, command.y - outline.centerY)
    else if (command.type === 'C')
      path.bezierCurveTo(
        command.x1 - outline.centerX,
        command.y1 - outline.centerY,
        command.x2 - outline.centerX,
        command.y2 - outline.centerY,
        command.x - outline.centerX,
        command.y - outline.centerY,
      )
    else if (command.type === 'Q')
      path.quadraticCurveTo(
        command.x1 - outline.centerX,
        command.y1 - outline.centerY,
        command.x - outline.centerX,
        command.y - outline.centerY,
      )
    else path.currentPath?.closePath()
  }
  const ringArea = (ring: { x: number; y: number }[]) =>
    Math.abs(
      ring.reduce((sum, point, index) => {
        const next = ring[(index + 1) % ring.length]
        return sum + point.x * next.y - next.x * point.y
      }, 0) / 2,
    )
  const filledArea = (shapes: Shape[]) =>
    shapes.reduce(
      (sum, shape) =>
        sum +
        ringArea(shape.getPoints(20)) -
        shape.holes.reduce(
          (holes, hole) => holes + ringArea(hole.getPoints(20)),
          0,
        ),
      0,
    )
  const clockwise = path.toShapes(false)
  const counterClockwise = path.toShapes(true)
  return filledArea(counterClockwise) > filledArea(clockwise)
    ? counterClockwise
    : clockwise
}

const sampled = (path: Shape | Path): ContourPoint[] =>
  path.getPoints(16).map((point) => [point.x, point.y])

export function shapeToFreeContour(
  panel: PanelDefinition,
): Extract<PanelShape, { type: 'free' }> {
  const thin = thinAxis(panel)
  const axes = ([0, 1, 2] as const).filter((axis) => axis !== thin)
  const width = panel.size[axes[0]],
    height = panel.size[axes[1]]
  const shape = panel.shape ?? { type: 'rectangle' as const }
  if (shape.type === 'free')
    return {
      type: 'free',
      sourceType: shape.sourceType,
      faces: shape.faces.map((face) => ({
        ...face,
        outer: face.outer.map((point) => [...point]),
        holes: face.holes.map((hole) => hole.map((point) => [...point])),
      })),
    }
  let faces: ContourFace[]
  if (shape.type === 'text' && shape.outline) {
    faces = textOutlineShapes(shape.outline).map((item, index) => ({
      id: `face-${index}`,
      outer: sampled(item),
      holes: item.holes.map(sampled),
    }))
  } else {
    const outer: ContourPoint[] =
      shape.type === 'triangle'
        ? [
            [0, height / 2],
            [-width / 2, -height / 2],
            [width / 2, -height / 2],
          ]
        : shape.type === 'star'
          ? Array.from({ length: shape.points * 2 }, (_, index) => {
              const radius = index % 2 ? shape.innerRatio : 1
              const angle = Math.PI / 2 + (index * Math.PI) / shape.points
              return [
                ((Math.cos(angle) * width) / 2) * radius,
                ((Math.sin(angle) * height) / 2) * radius,
              ] as ContourPoint
            })
          : shape.type === 'circle'
            ? polygon(Math.max(16, shape.segments), width / 2, height / 2)
            : shape.type === 'polygon'
              ? polygon(shape.sides, width / 2, height / 2)
              : [
                  [-width / 2, -height / 2],
                  [width / 2, -height / 2],
                  [width / 2, height / 2],
                  [-width / 2, height / 2],
                ]
    faces = [{ id: 'face-0', outer, holes: [] }]
  }
  return { type: 'free', sourceType: shape.type, faces }
}

export function contourShapes(faces: ContourFace[]) {
  return faces.map((face) => {
    const shape = new Shape()
    face.outer.forEach((point, index) =>
      index ? shape.lineTo(...point) : shape.moveTo(...point),
    )
    shape.closePath()
    shape.holes = face.holes.map((points) => {
      const hole = new Path()
      points.forEach((point, index) =>
        index ? hole.lineTo(...point) : hole.moveTo(...point),
      )
      hole.closePath()
      return hole
    })
    return shape
  })
}
