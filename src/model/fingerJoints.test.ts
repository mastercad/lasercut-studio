import { describe, expect, it } from 'vitest'
import { createBoxPanels, type PanelDefinition } from './box'
import {
  buildFingerJoint,
  fitClearance,
  fittedCornerSegmentCount,
} from './fingerJoints'
import { createPanelGeometry } from './panelGeometry'

const options = {
  fingerWidth: 12,
  fit: 'tight' as const,
  clearance: 0,
  style: 'straight' as const,
  reliefDiameter: 1,
}

describe('finger joints', () => {
  it('creates alternating additions and matching recesses for a corner', () => {
    const panels = createBoxPanels({
      width: 180,
      height: 120,
      depth: 100,
      thickness: 3,
      fingerWidth: 12,
    })
    const front = panels.find((panel) => panel.id === 'front')!
    const left = panels.find((panel) => panel.id === 'left')!
    const result = buildFingerJoint(front, left, options, 'corner-joint')
    expect('error' in result).toBe(false)
    if ('error' in result) return
    expect(result.definition.connectionType).toBe('corner')
    expect(
      result.firstFeatures.some((feature) => feature.operation === 'add'),
    ).toBe(true)
    expect(
      result.firstFeatures.some((feature) => feature.operation === 'subtract'),
    ).toBe(true)
    expect(
      result.secondFeatures.every(
        (feature) => feature.jointId === 'corner-joint',
      ),
    ).toBe(true)
    const assemblyBounds = { min: [-90, -60, -50], max: [90, 60, 50] }
    for (const [panel, features] of [
      [front, result.firstFeatures],
      [left, result.secondFeatures],
    ] as const) {
      for (const feature of features.filter(
        (item) => item.operation === 'add',
      )) {
        for (const axis of [0, 1, 2] as const) {
          const worldCenter = panel.position[axis] + feature.center[axis]
          expect(worldCenter - feature.size[axis] / 2).toBeGreaterThanOrEqual(
            assemblyBounds.min[axis] - 1e-6,
          )
          expect(worldCenter + feature.size[axis] / 2).toBeLessThanOrEqual(
            assemblyBounds.max[axis] + 1e-6,
          )
        }
      }
    }
  })

  it('always leaves a finger at both ends of a corner connection', () => {
    const panels = createBoxPanels({
      width: 80,
      height: 100,
      depth: 50,
      thickness: 3,
      fingerWidth: 12,
    })
    const first = panels.find((panel) => panel.id === 'front')!
    const second = panels.find((panel) => panel.id === 'left')!
    const result = buildFingerJoint(first, second, options, 'closed-ends')
    expect('error' in result).toBe(false)
    if ('error' in result) return

    const firstSegments = result.firstFeatures.filter(
      (feature) => feature.shape === 'box',
    )
    expect(firstSegments).toHaveLength(9)
    expect(firstSegments[0].operation).toBe('add')
    expect(firstSegments.at(-1)?.operation).toBe('add')
    expect(firstSegments.map((feature) => feature.operation)).toEqual(
      firstSegments.map((_, index) => (index % 2 === 0 ? 'add' : 'subtract')),
    )
  })

  it('chooses the closest odd segment count and handles invalid inputs safely', () => {
    expect(fittedCornerSegmentCount(100, 12)).toBe(9)
    // 120 / 12 would previously produce ten segments and an open end.
    expect(fittedCornerSegmentCount(120, 12)).toBe(11)
    expect(fittedCornerSegmentCount(13, 12)).toBe(1)
    expect(fittedCornerSegmentCount(100, 0)).toBe(0)
    expect(fittedCornerSegmentCount(100, Number.NaN)).toBe(0)
    expect(fittedCornerSegmentCount(0, 12)).toBe(0)
    expect(fittedCornerSegmentCount(Number.NaN, 12)).toBe(0)
  })

  it.each([
    [{ ...options, fingerWidth: 0 }, 'Fingerbreite'],
    [{ ...options, fingerWidth: Number.NaN }, 'Fingerbreite'],
    [{ ...options, clearance: Number.POSITIVE_INFINITY }, 'Spiel'],
    [{ ...options, reliefDiameter: -1 }, 'Fräserdurchmesser'],
  ])('rejects invalid joint options %#', (invalidOptions, message) => {
    const panels = createBoxPanels({
      width: 80,
      height: 100,
      depth: 50,
      thickness: 3,
      fingerWidth: 12,
    })
    const result = buildFingerJoint(
      panels.find((panel) => panel.id === 'front')!,
      panels.find((panel) => panel.id === 'left')!,
      invalidOptions,
      'invalid',
    )
    expect(result).toEqual({ error: expect.stringContaining(message) })
  })

  it('creates tabs on the first plate and internal slots on the second for a T-joint', () => {
    const first: PanelDefinition = {
      id: 'divider',
      label: 'Divider',
      size: [80, 100, 3],
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      cuts: [],
      booleanModifiers: [],
      jointFeatures: [],
      hidden: false,
    }
    const second: PanelDefinition = {
      id: 'receiver',
      label: 'Receiver',
      size: [80, 100, 3],
      position: [40, 0, 0],
      rotation: [0, Math.PI / 2, 0],
      cuts: [],
      booleanModifiers: [],
      jointFeatures: [],
      hidden: false,
    }
    const result = buildFingerJoint(first, second, options, 't-joint')
    expect('error' in result).toBe(false)
    if ('error' in result) return
    expect(result.definition.connectionType).toBe('t-joint')
    expect(
      result.firstFeatures.every((feature) => feature.operation === 'add'),
    ).toBe(true)
    expect(
      result.secondFeatures.every(
        (feature) => feature.operation === 'subtract',
      ),
    ).toBe(true)
  })

  it('uses the counterpart thickness for a mixed 3 mm / 5 mm connection', () => {
    const first: PanelDefinition = {
      id: 'three',
      label: '3 mm',
      size: [80, 100, 3],
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      cuts: [],
      booleanModifiers: [],
      jointFeatures: [],
      hidden: false,
    }
    const second: PanelDefinition = {
      id: 'five',
      label: '5 mm',
      size: [5, 100, 80],
      position: [40, 0, 0],
      rotation: [0, 0, 0],
      cuts: [],
      booleanModifiers: [],
      jointFeatures: [],
      hidden: false,
    }
    const result = buildFingerJoint(first, second, options, 'mixed')
    expect('error' in result).toBe(false)
    if ('error' in result) return
    const tab = result.firstFeatures.find(
      (feature) => feature.operation === 'add',
    )!
    const slot = result.secondFeatures.find(
      (feature) => feature.operation === 'subtract' && feature.shape === 'box',
    )!
    expect(tab.size[0]).toBe(5)
    expect(slot.size[2]).toBe(3)
    expect(slot.size[0]).toBe(7)
  })

  it('adds cylindrical relief features for dogbone style and evaluates the geometry', () => {
    const panels = createBoxPanels({
      width: 80,
      height: 60,
      depth: 50,
      thickness: 3,
      fingerWidth: 10,
    })
    const first = panels[0]
    const second = panels[2]
    const result = buildFingerJoint(
      first,
      second,
      { ...options, style: 'dogbone', reliefDiameter: 1.2 },
      'dogbone',
    )
    expect('error' in result).toBe(false)
    if ('error' in result) return
    const features = [...result.firstFeatures, ...result.secondFeatures]
    const slots = features.filter(
      (feature) => feature.operation === 'subtract' && feature.shape === 'box',
    )
    const reliefs = features.filter((feature) => feature.shape === 'cylinder')
    expect(reliefs.length).toBeGreaterThan(0)
    expect(reliefs.length).toBeLessThan(slots.length * 2)
    for (const relief of reliefs) {
      const sharedAxis = relief.axis === 1 ? 0 : 1
      expect(Math.abs(relief.center[sharedAxis])).toBeLessThan(
        first.size[sharedAxis] / 2,
      )
    }
    const geometry = createPanelGeometry({
      ...first,
      jointFeatures: result.firstFeatures,
    })
    expect(geometry.getAttribute('position').count).toBeGreaterThan(0)
    geometry.dispose()
  })

  it('keeps four Dogbone reliefs on closed T-joint slots but none at an open panel edge', () => {
    const first: PanelDefinition = {
      id: 'divider',
      label: 'Divider',
      size: [80, 100, 3],
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      cuts: [],
      booleanModifiers: [],
      jointFeatures: [],
      hidden: false,
    }
    const second: PanelDefinition = {
      id: 'receiver',
      label: 'Receiver',
      size: [80, 100, 3],
      position: [40, 0, 0],
      rotation: [0, Math.PI / 2, 0],
      cuts: [],
      booleanModifiers: [],
      jointFeatures: [],
      hidden: false,
    }
    const result = buildFingerJoint(
      first,
      second,
      { ...options, style: 'dogbone', reliefDiameter: 1.2 },
      't-dogbone',
    )
    expect('error' in result).toBe(false)
    if ('error' in result) return
    const slots = result.secondFeatures.filter(
      (feature) => feature.operation === 'subtract' && feature.shape === 'box',
    )
    const reliefs = result.secondFeatures.filter(
      (feature) => feature.shape === 'cylinder',
    )
    expect(reliefs.length).toBeGreaterThan(0)
    expect(reliefs.length).toBeLessThan(slots.length * 4)
    expect(reliefs.length).toBe(slots.length * 4 - 2)
  })

  it('maps fit presets to deterministic clearances', () => {
    expect(fitClearance('press', 99)).toBe(-0.12)
    expect(fitClearance('tight', 99)).toBe(0)
    expect(fitClearance('loose', 99)).toBe(0.2)
    expect(fitClearance('custom', 0.07)).toBe(0.07)
  })
})
