import { describe, expect, it } from 'vitest'
import { createBoxPanels, defaultMaterials, type PanelDefinition } from './box'
import {
  buildProjectExportSteps,
  createDefaultExportLayers,
  createDefaultLaserPresets,
  createDefaultProcessingProfiles,
  createDefaultProcessingRecipes,
  createMaterialDxf,
  createMaterialSvg,
  createProfiledMaterialDxf,
  createProfiledMaterialSvg,
  defaultLaserCutters,
  extractPanelContours,
} from './export'
import { createExportPackage } from './export'
import JSZip from 'jszip'
import { buildFingerJoint } from './fingerJoints'

describe('LightBurn export', () => {
  it('creates a millimetre DXF 2000 with closed polylines and true-colour layers', () => {
    const material = defaultMaterials[0]
    const panel: PanelDefinition = {
      id: 'dxf-panel',
      label: 'DXF Panel',
      size: [40, 30, 3],
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      cuts: [{ id: 'hole', kind: 'hole', center: [0, 0, 0], size: [8, 8, 4] }],
      booleanModifiers: [],
      jointFeatures: [],
      hidden: false,
      visible: true,
      materialId: material.id,
      autoCut: true,
      processingAssignments: [],
    }
    const layers = createDefaultExportLayers([material])
    const dxf = createMaterialDxf(material, [panel], [panel], layers)
    expect(dxf).toContain('9\n$ACADVER\n1\nAC1015\n')
    expect(dxf).toContain('9\n$INSUNITS\n70\n4\n')
    expect(dxf).toContain('2\n04_Innenschnitt\n')
    expect(dxf).toContain('2\n05_Aussenschnitt\n')
    expect(dxf.match(/0\nLWPOLYLINE\n/g)).toHaveLength(2)
    expect(dxf.match(/70\n1\n/g)?.length).toBeGreaterThanOrEqual(2)
    expect(dxf.trimEnd().endsWith('0\nEOF')).toBe(true)
  })

  it('keeps profiled DXF steps ordered and emits fill profiles as vector boundaries', () => {
    const material = defaultMaterials[0]
    const profiles = createDefaultProcessingProfiles()
    const engraving = profiles.find((profile) => profile.geometry === 'fill')!
    const recipes = createDefaultProcessingRecipes(
      profiles,
      defaultLaserCutters,
      [material],
    )
    const panel: PanelDefinition = {
      id: 'profiled-dxf',
      label: 'Gravurteil',
      size: [30, 20, 3],
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      cuts: [],
      booleanModifiers: [],
      jointFeatures: [],
      hidden: false,
      visible: true,
      materialId: material.id,
      autoCut: true,
      processingAssignments: [
        { id: 'engrave', profileId: engraving.id, geometry: 'fill' },
      ],
    }
    const dxf = createProfiledMaterialDxf(
      material,
      [panel],
      [panel],
      profiles,
      recipes,
      defaultLaserCutters[0].id,
    )
    const engravingLayer = dxf.indexOf('2\n01_Leichte_Flachengravur\n')
    const outerLayer = dxf.indexOf('2\n02_Aussenschnitte_automatisch_erkannt\n')
    expect(engravingLayer).toBeGreaterThan(-1)
    expect(outerLayer).toBeGreaterThan(engravingLayer)
    expect(dxf.match(/0\nLWPOLYLINE\n/g)).toHaveLength(2)
  })

  it('exports contours for ordinary indexed box geometries', () => {
    const panels = createBoxPanels({
      width: 80,
      height: 60,
      depth: 50,
      thickness: 3,
      fingerWidth: 10,
    })
    const contours = extractPanelContours(panels[0], panels)
    expect(contours.outer).toHaveLength(1)
    expect(contours.width).toBeCloseTo(80)
    expect(contours.height).toBeCloseTo(60)
    const svg = createMaterialSvg(
      defaultMaterials[0],
      panels,
      panels,
      createDefaultExportLayers(defaultMaterials),
    )
    expect(svg.match(/<path /g) ?? []).toHaveLength(6)
  })

  it('packs multiple parts into rows instead of one very wide strip', () => {
    const panels = Array.from({ length: 8 }, (_, index): PanelDefinition => ({
      id: `part-${index}`,
      label: `Part ${index}`,
      size: [100, 40, 3],
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      cuts: [],
      booleanModifiers: [],
      jointFeatures: [],
      hidden: false,
      materialId: defaultMaterials[0].id,
    }))
    const svg = createMaterialSvg(
      defaultMaterials[0],
      panels,
      panels,
      createDefaultExportLayers(defaultMaterials),
    )
    const [, width, height] = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/) ?? []

    expect(Number(width)).toBeLessThan(500)
    expect(Number(height)).toBeGreaterThan(100)
  })

  it('attaches every partially overlapping engraving regardless of its depth', () => {
    const material = defaultMaterials[0]
    const profiles = createDefaultProcessingProfiles()
    const engravingProfile = profiles.find(
      (profile) => profile.geometry === 'fill',
    )!
    const host: PanelDefinition = {
      id: 'host',
      label: 'Schild',
      size: [100, 50, 5],
      position: [0, 0, 0],
      rotation: [Math.PI / 2, 0, 0],
      cuts: [],
      booleanModifiers: [],
      jointFeatures: [],
      hidden: false,
      materialId: material.id,
      autoCut: true,
      processingAssignments: [],
    }
    const text: PanelDefinition = {
      ...host,
      id: 'engraving-text',
      label: 'Gravurtext',
      size: [20, 10, 5],
      position: [55, 100, 0],
      autoCut: false,
      processingAssignments: [
        { id: 'engraving', profileId: engravingProfile.id, geometry: 'fill' },
      ],
      shape: {
        type: 'text',
        text: 'Text',
        fontFamily: 'DIN',
        fontSize: 10,
        operation: 'engrave-fill',
        outline: null,
      },
    }
    const engravingShape: PanelDefinition = {
      ...text,
      id: 'engraving-shape',
      label: 'Gravurfläche',
      position: [-55, -100, 0],
      shape: { type: 'rectangle' },
    }
    const contours = (panel: PanelDefinition) => ({
      outer: [
        [
          [0, 0],
          [panel.size[0], 0],
          [panel.size[0], panel.size[1]],
          [0, panel.size[1]],
        ] as [number, number][],
      ],
      inner: [],
      width: panel.size[0],
      height: panel.size[1],
      minX: -panel.size[0] / 2,
      maxY: panel.size[1] / 2,
    })
    const svg = createProfiledMaterialSvg(
      material,
      [host, text, engravingShape],
      [host, text, engravingShape],
      profiles,
      createDefaultProcessingRecipes(
        profiles,
        defaultLaserCutters,
        defaultMaterials,
      ),
      defaultLaserCutters[0].id,
      undefined,
      [],
      contours,
    )

    expect(svg).toContain('data-object-id="engraving-text"')
    expect(svg).toContain('data-object-id="engraving-shape"')
    expect(svg).toContain('viewBox="0 0 120 70"')
  })

  it('separates through holes from the exterior contour', () => {
    const panel: PanelDefinition = {
      id: 'plate',
      label: 'Plate',
      size: [80, 60, 3],
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      cuts: [
        { id: 'hole', kind: 'hole', center: [0, 0, 0], size: [20, 10, 5] },
      ],
      booleanModifiers: [],
      jointFeatures: [],
      hidden: false,
      materialId: 'birch-3',
    }
    const contours = extractPanelContours(panel, [panel])
    expect(contours.outer).toHaveLength(1)
    expect(contours.inner).toHaveLength(1)
    expect(contours.width).toBeCloseTo(80)
    expect(contours.height).toBeCloseTo(60)
  })

  it('exports real finger geometry as an exterior contour', () => {
    const panels = createBoxPanels({
      width: 80,
      height: 60,
      depth: 50,
      thickness: 3,
      fingerWidth: 10,
    })
    const first = panels[0],
      second = panels[2]
    const joint = buildFingerJoint(
      first,
      second,
      {
        fingerWidth: 10,
        fit: 'tight',
        clearance: 0,
        style: 'straight',
        reliefDiameter: 1,
      },
      'joint',
    )
    expect('error' in joint).toBe(false)
    if ('error' in joint) return
    const contours = extractPanelContours(
      { ...first, jointFeatures: joint.firstFeatures },
      panels,
    )
    expect(contours.outer).toHaveLength(1)
    expect(contours.outer[0].length).toBeGreaterThan(4)
  })

  it('writes inner cuts before outer cuts with distinct material-layer colors', () => {
    const material = defaultMaterials[0]
    const panel: PanelDefinition = {
      id: 'plate',
      label: 'Plate',
      size: [80, 60, 3],
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      cuts: [
        { id: 'hole', kind: 'hole', center: [0, 0, 0], size: [20, 10, 5] },
      ],
      booleanModifiers: [],
      jointFeatures: [],
      hidden: false,
      materialId: material.id,
    }
    const layers = createDefaultExportLayers(defaultMaterials)
    const svg = createMaterialSvg(material, [panel], [panel], layers)
    const inner = layers.find(
      (layer) =>
        layer.materialId === material.id && layer.operation === 'cut-inner',
    )!
    const outer = layers.find(
      (layer) =>
        layer.materialId === material.id && layer.operation === 'cut-outer',
    )!
    expect(svg.indexOf(`id="${inner.id}"`)).toBeLessThan(
      svg.indexOf(`id="${outer.id}"`),
    )
    expect(inner.color).not.toBe(outer.color)
    expect(svg).toContain('data-speed=')
    expect(svg).toContain('Birke Multiplex 3mm')
  })

  it('stores the assembly and object name on every exported path', () => {
    const panels = createBoxPanels({
      width: 80,
      height: 60,
      depth: 50,
      thickness: 3,
      fingerWidth: 10,
    })
    const groups = [
      {
        id: 'assembly-a',
        name: 'Rahmen links',
        panelIds: panels.map((panel) => panel.id),
      },
    ]
    const svg = createMaterialSvg(
      defaultMaterials[0],
      panels,
      panels,
      createDefaultExportLayers(defaultMaterials),
      groups,
    )
    expect(svg).toContain('inkscape:label="Rahmen links / Vorderseite"')
    expect(svg).toContain('data-group="Rahmen links"')
    expect(svg).toContain('data-object="Vorderseite"')
  })

  it('exports laser text in its selected layer with the system font name', () => {
    const material = defaultMaterials[0]
    const panel: PanelDefinition = {
      id: 'sign',
      label: 'Schild',
      size: [80, 60, 3],
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      cuts: [],
      booleanModifiers: [],
      jointFeatures: [],
      hidden: false,
      materialId: material.id,
    }
    const text = {
      id: 'text-1',
      label: 'Kabinenbeschriftung',
      panelId: panel.id,
      text: 'Kabine 7',
      fontFamily: 'DIN 1451',
      fontSize: 12,
      position: [5, -4] as [number, number],
      rotation: 15,
      operation: 'engrave-fill' as const,
    }
    const svg = createMaterialSvg(
      material,
      [panel],
      [panel],
      createDefaultExportLayers(defaultMaterials),
      [],
      [text],
    )
    expect(svg).toContain('>Kabine 7</text>')
    expect(svg).toContain('font-family="DIN 1451"')
    expect(svg).toContain('data-operation="engrave-fill"')
    expect(svg).toContain('rotate(-15')
  })

  it('routes a standalone text shape to engraving instead of the outer-cut layer', () => {
    const material = defaultMaterials[0]
    const outline = {
      width: 20,
      height: 30,
      centerX: 10,
      centerY: 15,
      commands: [
        { type: 'M' as const, x: 0, y: 0 },
        { type: 'L' as const, x: 20, y: 0 },
        { type: 'L' as const, x: 20, y: 30 },
        { type: 'L' as const, x: 0, y: 30 },
        { type: 'Z' as const },
      ],
    }
    const panel: PanelDefinition = {
      id: 'standalone-text',
      label: 'Freier Text',
      size: [20, 30, 3],
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      cuts: [],
      booleanModifiers: [],
      jointFeatures: [],
      hidden: false,
      materialId: material.id,
      shape: {
        type: 'text',
        text: 'I',
        fontFamily: 'DIN',
        fontSize: 30,
        operation: 'engrave-line',
        outline,
      },
    }
    const svg = createMaterialSvg(
      material,
      [panel],
      [panel],
      createDefaultExportLayers(defaultMaterials),
    )
    const engraveLayer =
      svg.match(/<g[^>]+data-operation="engrave-line"[\s\S]*?<\/g>/)?.[0] ?? ''
    const outerLayer =
      svg.match(/<g[^>]+data-operation="cut-outer"[\s\S]*?<\/g>/)?.[0] ?? ''
    expect(engraveLayer).toContain('data-object-id="standalone-text"')
    expect(outerLayer).not.toContain('data-object-id="standalone-text"')
    const dxf = createMaterialDxf(
      material,
      [panel],
      [panel],
      createDefaultExportLayers(defaultMaterials),
    )
    expect(dxf).toContain('8\n02_Konturgravur\n')
    expect(dxf).not.toContain('8\n05_Aussenschnitt\n')
    expect(dxf.match(/0\nLWPOLYLINE\n/g)).toHaveLength(1)
  })

  it('packages separate SVG jobs per material with a machine-readable manifest', async () => {
    const profiles = createDefaultProcessingProfiles()
    const panels = createBoxPanels({
      width: 80,
      height: 60,
      depth: 50,
      thickness: 3,
      fingerWidth: 10,
    })
    panels[0].materialId = 'birch-5'
    const blob = await createExportPackage(
      defaultMaterials,
      panels,
      createDefaultExportLayers(defaultMaterials),
      defaultLaserCutters[0],
      createDefaultLaserPresets(defaultLaserCutters, defaultMaterials),
      [],
      [],
      profiles,
      createDefaultProcessingRecipes(
        profiles,
        defaultLaserCutters,
        defaultMaterials,
      ),
    )
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    expect(zip.file('Birke_Multiplex_3mm.svg')).not.toBeNull()
    expect(zip.file('Birke_Multiplex_5mm.svg')).not.toBeNull()
    expect(zip.file('Birke_Multiplex_3mm.dxf')).not.toBeNull()
    expect(zip.file('Birke_Multiplex_5mm.dxf')).not.toBeNull()
    expect(zip.file('Birke_Multiplex_3mm.lbrn2')).not.toBeNull()
    expect(zip.file('Birke_Multiplex_5mm.lbrn2')).not.toBeNull()
    const manifest = JSON.parse(
      await zip.file('export-manifest.json')!.async('string'),
    )
    expect(
      manifest.materials.map(
        (material: { thickness: number }) => material.thickness,
      ),
    ).toEqual([3, 5])
    expect(manifest.laser).toMatchObject({
      name: 'Generischer Diodenlaser',
      powerWatts: 10,
    })
    expect(manifest.presets.length).toBeGreaterThan(0)
    expect(manifest.version).toBe(5)
    expect(manifest.files).toContain('Birke_Multiplex_3mm.dxf')
    expect(manifest.files).toContain('Birke_Multiplex_3mm.lbrn2')
  })

  it('builds only used profile layers and keeps automatic inner cuts before outer cuts', () => {
    const material = defaultMaterials[0]
    const profiles = createDefaultProcessingProfiles()
    const recipes = createDefaultProcessingRecipes(
      profiles,
      defaultLaserCutters,
      defaultMaterials,
    )
    const engraving = profiles.find((profile) => profile.geometry === 'fill')!
    const panel: PanelDefinition = {
      id: 'sign',
      label: 'Schild',
      size: [80, 60, 3],
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      cuts: [
        { id: 'hole', kind: 'hole', center: [0, 0, 0], size: [10, 10, 4] },
      ],
      booleanModifiers: [],
      jointFeatures: [],
      hidden: false,
      visible: true,
      materialId: material.id,
      autoCut: true,
      processingAssignments: [
        { id: 'a', profileId: engraving.id, geometry: 'fill' },
      ],
    }
    const steps = buildProjectExportSteps(
      material,
      [panel],
      profiles,
      recipes,
      defaultLaserCutters[0].id,
    )
    expect(steps.map((step) => step.kind)).toEqual([
      'profile',
      'cut-inner',
      'cut-outer',
    ])
    expect(steps[0]).toMatchObject({
      name: engraving.name,
      objectIds: ['sign'],
    })
    expect(steps.some((step) => step.name === 'Tiefe Flächengravur')).toBe(
      false,
    )
    const svg = createProfiledMaterialSvg(
      material,
      [panel],
      [panel],
      profiles,
      recipes,
      defaultLaserCutters[0].id,
    )
    expect(svg).toContain(`id="profile:${engraving.id}"`)
    expect(svg.indexOf('id="cut-inner:')).toBeLessThan(
      svg.indexOf('id="cut-outer:'),
    )
  })

  it('keeps inner and outer cuts as separate configurable LightBurn layers', () => {
    const material = defaultMaterials[0]
    const profiles = createDefaultProcessingProfiles()
    const panel: PanelDefinition = {
      id: 'cut-test',
      label: 'Schnitt-Test',
      size: [50, 40, 3],
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      cuts: [{ id: 'hole', kind: 'hole', center: [0, 0, 0], size: [8, 8, 4] }],
      booleanModifiers: [],
      jointFeatures: [],
      hidden: false,
      visible: true,
      materialId: material.id,
      autoCut: true,
      processingAssignments: [],
    }
    const defaults = createDefaultLaserPresets(defaultLaserCutters, [material])
    const inner = {
      ...defaults.find((preset) => preset.operation === 'cut-inner')!,
      speed: 12,
      layerColor: '#12ab34',
    }
    const outer = {
      ...defaults.find((preset) => preset.operation === 'cut-outer')!,
      speed: 8,
      layerColor: '#fedc21',
    }
    const steps = buildProjectExportSteps(
      material,
      [panel],
      profiles,
      [],
      defaultLaserCutters[0].id,
      { inner, outer },
    )
    expect(steps.map((step) => [step.kind, step.speed, step.color])).toEqual([
      ['cut-inner', 12, '#12ab34'],
      ['cut-outer', 8, '#fedc21'],
    ])
  })

  it('omits automatic cuts for explicitly excluded objects while retaining assigned profiles', () => {
    const material = defaultMaterials[0]
    const profiles = createDefaultProcessingProfiles()
    const recipes = createDefaultProcessingRecipes(
      profiles,
      defaultLaserCutters,
      defaultMaterials,
    )
    const engraving = profiles.find(
      (profile) => profile.geometry === 'contour',
    )!
    const panel: PanelDefinition = {
      id: 'mark',
      label: 'Markierung',
      size: [20, 20, 3],
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      cuts: [],
      booleanModifiers: [],
      jointFeatures: [],
      hidden: false,
      materialId: material.id,
      autoCut: false,
      processingAssignments: [
        { id: 'a', profileId: engraving.id, geometry: 'contour' },
      ],
    }
    const steps = buildProjectExportSteps(
      material,
      [panel],
      profiles,
      recipes,
      defaultLaserCutters[0].id,
    )
    expect(steps).toHaveLength(1)
    expect(steps[0].kind).toBe('profile')
  })

  it('keeps profiles and contour counts stable when a laser recipe is missing', () => {
    const material = defaultMaterials[0]
    const profiles = createDefaultProcessingProfiles()
    const configuredLaser = defaultLaserCutters[0]
    const unconfiguredLaser = {
      ...configuredLaser,
      id: 'other-laser',
      name: 'Anderer Laser',
    }
    const recipes = createDefaultProcessingRecipes(
      profiles,
      [configuredLaser],
      [material],
    )
    const profile = profiles[1]
    const panel: PanelDefinition = {
      id: 'sign',
      label: 'Schild',
      size: [80, 60, 3],
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      cuts: [],
      booleanModifiers: [],
      jointFeatures: [],
      hidden: false,
      materialId: material.id,
      autoCut: true,
      processingAssignments: [
        { id: 'a', profileId: profile.id, geometry: profile.geometry },
      ],
    }
    const cutPreset = createDefaultLaserPresets(
      [configuredLaser],
      [material],
    ).find((preset) => preset.operation === 'cut-outer')
    const configured = buildProjectExportSteps(
      material,
      [panel],
      profiles,
      recipes,
      configuredLaser.id,
      cutPreset,
    )
    const missing = buildProjectExportSteps(
      material,
      [panel],
      profiles,
      recipes,
      unconfiguredLaser.id,
      cutPreset,
    )
    expect(
      missing.map((step) => [step.kind, step.contourCount, step.objectIds]),
    ).toEqual(
      configured.map((step) => [step.kind, step.contourCount, step.objectIds]),
    )
    expect(configured[0].configured).toBe(true)
    expect(missing[0]).toMatchObject({
      profileId: profile.id,
      configured: false,
    })
  })

  it('shares a supplied contour cache across analysis, preview and package generation', async () => {
    const material = defaultMaterials[0]
    const panel: PanelDefinition = {
      ...createBoxPanels({
        width: 40,
        height: 30,
        depth: 20,
        thickness: 3,
        fingerWidth: 5,
      })[0],
      autoCut: true,
      processingAssignments: [],
    }
    const profiles = createDefaultProcessingProfiles()
    const recipes = createDefaultProcessingRecipes(
      profiles,
      defaultLaserCutters,
      defaultMaterials,
    )
    const cached = new Map<string, ReturnType<typeof extractPanelContours>>()
    let evaluations = 0
    const provider = (candidate: PanelDefinition, all: PanelDefinition[]) => {
      const existing = cached.get(candidate.id)
      if (existing) return existing
      evaluations++
      const contours = extractPanelContours(candidate, all)
      cached.set(candidate.id, contours)
      return contours
    }
    buildProjectExportSteps(
      material,
      [panel],
      profiles,
      recipes,
      defaultLaserCutters[0].id,
      undefined,
      provider,
    )
    createProfiledMaterialSvg(
      material,
      [panel],
      [panel],
      profiles,
      recipes,
      defaultLaserCutters[0].id,
      undefined,
      [],
      provider,
    )
    await createExportPackage(
      defaultMaterials,
      [panel],
      createDefaultExportLayers(defaultMaterials),
      defaultLaserCutters[0],
      createDefaultLaserPresets(defaultLaserCutters, defaultMaterials),
      [],
      [],
      profiles,
      recipes,
      provider,
    )
    expect(evaluations).toBe(1)
  })
})
