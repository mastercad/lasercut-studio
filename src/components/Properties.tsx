import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import {
  ArrowDownUp,
  Check,
  ChevronDown,
  Ruler,
  Search,
  Settings2,
} from 'lucide-react'
import {
  thinAxis,
  type BooleanOperation,
  type BoxDimensions,
  type FingerStyle,
  type FitPreset,
  type PanelShape,
} from '../model/box'
import { analyzeConnection } from '../model/connectionAnalysis'
import { buildCrossJoint } from '../model/crossJoints'
import { buildFingerJoint } from '../model/fingerJoints'
import {
  bundledFontFamily,
  createBundledTextOutline,
  createSystemTextOutline,
  listInstalledSystemFonts,
} from '../model/fonts'
import { useEditor } from '../store/editor'
import { worldHalfExtents } from '../model/snapping'
import { ProcessingProfileDialog } from './ProcessingProfileDialog'

const fields: { key: keyof BoxDimensions; label: string; min: number }[] = [
  { key: 'width', label: 'Breite', min: 20 },
  { key: 'height', label: 'Höhe', min: 20 },
  { key: 'depth', label: 'Tiefe', min: 20 },
  { key: 'fingerWidth', label: 'Fingerbreite', min: 2 },
]

const booleanLabels: Record<BooleanOperation, string> = {
  subtract: 'Differenz · Werkzeug abziehen',
  union: 'Vereinigung',
  intersect: 'Schnittmenge',
  xor: 'XOR · Überlappung entfernen',
  'reverse-subtract': 'Umgekehrte Differenz',
}

const sidebarAccordionKey = 'lasercut-studio.sidebar-accordions.v1'

function savedAccordionState(id: string, fallback: boolean) {
  if (typeof localStorage === 'undefined') return fallback
  try {
    const saved = JSON.parse(localStorage.getItem(sidebarAccordionKey) || '{}')
    return typeof saved[id] === 'boolean' ? saved[id] : fallback
  } catch {
    return fallback
  }
}

function SidebarAccordion({
  id,
  title,
  className = '',
  defaultOpen = true,
  onOpenChange,
  children,
}: {
  id: string
  title: ReactNode
  className?: string
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  children: ReactNode
}) {
  const [open, setOpen] = useState(() => savedAccordionState(id, defaultOpen))
  const update = (next: boolean) => {
    setOpen(next)
    onOpenChange?.(next)
    if (typeof localStorage === 'undefined') return
    try {
      const saved = JSON.parse(
        localStorage.getItem(sidebarAccordionKey) || '{}',
      )
      localStorage.setItem(
        sidebarAccordionKey,
        JSON.stringify({ ...saved, [id]: next }),
      )
    } catch {
      // The sidebar remains usable when browser storage is unavailable.
    }
  }
  return (
    <details
      className={`sidebar-accordion ${className}`.trim()}
      open={open}
      onToggle={(event) => update(event.currentTarget.open)}
    >
      <summary>
        <span>{title}</span>
        <ChevronDown />
      </summary>
      <div className="sidebar-accordion-content">{children}</div>
    </details>
  )
}

function DimensionInput({
  value,
  onCommit,
}: {
  value: number
  onCommit: (value: number) => void
}) {
  const [draft, setDraft] = useState(String(Number(value.toFixed(2))))
  useEffect(() => setDraft(String(Number(value.toFixed(2)))), [value])
  const commit = () => {
    const parsed = Number(draft.replace(',', '.'))
    if (!Number.isFinite(parsed)) {
      setDraft(String(Number(value.toFixed(2))))
      return
    }
    const next = Math.max(0.5, parsed)
    setDraft(String(next))
    if (Math.abs(next - value) > 1e-8) onCommit(next)
  }
  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
      }}
    />
  )
}

function PositionInput({
  value,
  onCommit,
}: {
  value: number
  onCommit: (value: number) => void
}) {
  const display = (number: number) => String(Number(number.toFixed(3)))
  const [draft, setDraft] = useState(display(value))
  useEffect(() => setDraft(display(value)), [value])
  const commit = () => {
    const parsed = Number(draft.replace(',', '.'))
    if (!Number.isFinite(parsed)) {
      setDraft(display(value))
      return
    }
    setDraft(display(parsed))
    if (Math.abs(parsed - value) > 1e-8) onCommit(parsed)
  }
  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') {
          setDraft(display(value))
          event.currentTarget.blur()
        }
      }}
    />
  )
}

function SystemFontPicker({
  fonts,
  value,
  onChange,
  onLoad,
}: {
  fonts: string[]
  value: string
  onChange: (font: string) => void
  onLoad: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLocaleLowerCase('de')
  const filtered = normalizedQuery
    ? fonts.filter((font) =>
        font.toLocaleLowerCase('de').includes(normalizedQuery),
      )
    : fonts
  return (
    <div className={`system-font-picker${open ? ' open' : ''}`}>
      <button
        className="font-selection"
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        <span style={{ fontFamily: value }}>{value}</span>
        <ChevronDown />
      </button>
      {open && (
        <div className="font-picker-popover">
          <div className="font-search">
            <Search />
            <input
              autoFocus
              value={query}
              placeholder="Schriftarten filtern…"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {!fonts.length ? (
            <div className="font-empty">
              <span>Systemschriftliste noch nicht geladen.</span>
              <button type="button" onClick={onLoad}>
                Systemschriften laden
              </button>
            </div>
          ) : (
            <>
              <div className="font-result-count">
                {filtered.length} von {fonts.length} Schriftarten
              </div>
              <div className="font-options" role="listbox">
                {filtered.map((font) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={font === value}
                    key={font}
                    style={{ fontFamily: font }}
                    onClick={() => {
                      onChange(font)
                      setOpen(false)
                      setQuery('')
                    }}
                  >
                    <span>{font}</span>
                    {font === value && <Check />}
                  </button>
                ))}
              </div>
              {!filtered.length && (
                <div className="font-empty">
                  <span>Keine passende Schriftart.</span>
                </div>
              )}
              <button className="reload-fonts" type="button" onClick={onLoad}>
                Systemschriften neu einlesen
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export function Properties() {
  const [connectionType, setConnectionType] = useState<
    'finger' | 'tab-slot' | 'cross'
  >('finger')
  const [connectionBuilderOpen, setConnectionBuilderOpen] = useState(() =>
    savedAccordionState('connection-builder', true),
  )
  const [crossRatio, setCrossRatio] = useState(50)
  const [crossFirstFromHigh, setCrossFirstFromHigh] = useState(true)
  const [booleanOperation, setBooleanOperation] =
    useState<BooleanOperation>('subtract')
  const [fingerWidth, setFingerWidth] = useState(12)
  const [fitPreset, setFitPreset] = useState<FitPreset>('tight')
  const [customClearance, setCustomClearance] = useState(0)
  const [fingerStyle, setFingerStyle] = useState<FingerStyle>('straight')
  const [reliefDiameter, setReliefDiameter] = useState(1)
  const [materialEditorId, setMaterialEditorId] = useState('birch-3')
  const [materialName, setMaterialName] = useState('Birke Multiplex')
  const [materialThickness, setMaterialThickness] = useState(3)
  const [materialKerf, setMaterialKerf] = useState(0.15)
  const [materialColor, setMaterialColor] = useState('#d9a96c')
  const [materialMinimumBackbone, setMaterialMinimumBackbone] = useState(0)
  const [materialMinimumWeb, setMaterialMinimumWeb] = useState(0)
  const [systemFonts, setSystemFonts] = useState<string[]>([])
  const [contourX, setContourX] = useState(1)
  const [contourY, setContourY] = useState(0)
  const [profileDialogOpen, setProfileDialogOpen] = useState(false)
  const [socketCount, setSocketCount] = useState(4)
  const [socketSpan, setSocketSpan] = useState(60)
  const [socketLength, setSocketLength] = useState(15)
  const [socketClearance, setSocketClearance] = useState(0.2)
  const [socketMaterialId, setSocketMaterialId] = useState('birch-3')
  const [socketTargetPanelId, setSocketTargetPanelId] = useState('')
  const box = useEditor((state) => state.box)
  const setDimension = useEditor((state) => state.setDimension)
  const selected = useEditor((state) => state.selectedPanels)
  const selectedGroupId = useEditor((state) => state.selectedGroupId)
  const groups = useEditor((state) => state.groups)
  const panels = useEditor((state) => state.panels)
  const materials = useEditor((state) => state.materials)
  const assignMaterial = useEditor((state) => state.assignMaterial)
  const addMaterial = useEditor((state) => state.addMaterial)
  const updateMaterial = useEditor((state) => state.updateMaterial)
  const setSelectionHeight = useEditor((state) => state.setSelectionHeight)
  const setSelectionPosition = useEditor((state) => state.setSelectionPosition)
  const setSelectionColor = useEditor((state) => state.setSelectionColor)
  const resizePanel = useEditor((state) => state.resizePanel)
  const setPanelPosition = useEditor((state) => state.setPanelPosition)
  const updatePanelShape = useEditor((state) => state.updatePanelShape)
  const geometrySelectionMode = useEditor(
    (state) => state.geometrySelectionMode,
  )
  const contourSelection = useEditor((state) => state.contourSelection)
  const moveSelectedContour = useEditor((state) => state.moveSelectedContour)
  const selectPanel = useEditor((state) => state.selectPanel)
  const removeSelected = useEditor((state) => state.removeSelected)
  const rotatePanel = useEditor((state) => state.rotatePanel)
  const applyBoolean = useEditor((state) => state.applyBoolean)
  const swapSelectionOrder = useEditor((state) => state.swapSelectionOrder)
  const updateBoolean = useEditor((state) => state.updateBoolean)
  const removeBoolean = useEditor((state) => state.removeBoolean)
  const createFingerJoint = useEditor((state) => state.createFingerJoint)
  const removeFingerJoint = useEditor((state) => state.removeFingerJoint)
  const removeFingerJointsFromSelection = useEditor(
    (state) => state.removeFingerJointsFromSelection,
  )
  const fingerJoints = useEditor((state) => state.fingerJoints)
  const crossJoints = useEditor((state) => state.crossJoints)
  const createCrossJoint = useEditor((state) => state.createCrossJoint)
  const removeCrossJoint = useEditor((state) => state.removeCrossJoint)
  const socketPatterns = useEditor((state) => state.socketPatterns)
  const createSocketPattern = useEditor((state) => state.createSocketPattern)
  const updateSocketInstance = useEditor((state) => state.updateSocketInstance)
  const removeSocketPattern = useEditor((state) => state.removeSocketPattern)
  const transferSocketPattern = useEditor(
    (state) => state.transferSocketPattern,
  )
  const rotationPreview = useEditor((state) => state.rotationPreview)
  const setJointPreview = useEditor((state) => state.setJointPreview)
  const inspectionFocus = useEditor((state) => state.inspectionFocus)
  const setInspectionFocus = useEditor((state) => state.setInspectionFocus)
  const updateCut = useEditor((state) => state.updateCut)
  const removeCut = useEditor((state) => state.removeCut)
  const processingProfiles = useEditor((state) => state.processingProfiles)
  const addProcessingAssignment = useEditor(
    (state) => state.addProcessingAssignment,
  )
  const removeProcessingAssignment = useEditor(
    (state) => state.removeProcessingAssignment,
  )
  const setPanelAutoCut = useEditor((state) => state.setPanelAutoCut)
  const selectedPanel =
    selected.length === 1
      ? panels.find((panel) => panel.id === selected[0])
      : undefined
  const focusRegion = (
    sourceId: string,
    regions: {
      center: [number, number, number]
      size: [number, number, number]
    }[],
    clipToPanel: boolean | readonly (0 | 1 | 2)[] = false,
  ) => {
    if (!selectedPanel || !regions.length) return
    if (inspectionFocus?.sourceId === sourceId) {
      setInspectionFocus(null)
      return
    }
    const min = [Infinity, Infinity, Infinity]
    const max = [-Infinity, -Infinity, -Infinity]
    const clippedAxes = Array.isArray(clipToPanel)
      ? new Set<0 | 1 | 2>(clipToPanel)
      : null
    for (const region of regions)
      for (const axis of [0, 1, 2] as const) {
        const regionMin = region.center[axis] - region.size[axis] / 2
        const regionMax = region.center[axis] + region.size[axis] / 2
        const clipAxis = clipToPanel === true || clippedAxes?.has(axis)
        min[axis] = Math.min(
          min[axis],
          clipAxis
            ? Math.max(regionMin, -selectedPanel.size[axis] / 2)
            : regionMin,
        )
        max[axis] = Math.max(
          max[axis],
          clipAxis
            ? Math.min(regionMax, selectedPanel.size[axis] / 2)
            : regionMax,
        )
      }
    setInspectionFocus({
      requestId: Date.now(),
      sourceId,
      panelId: selectedPanel.id,
      center: min.map((value, axis) => (value + max[axis]) / 2) as [
        number,
        number,
        number,
      ],
      size: min.map((value, axis) => Math.max(0.2, max[axis] - value)) as [
        number,
        number,
        number,
      ],
    })
  }
  const focusJoint = (jointId: string) => {
    if (!selectedPanel) return
    focusRegion(
      jointId,
      [
        ...selectedPanel.cuts.filter((cut) => cut.jointId === jointId),
        ...selectedPanel.jointFeatures.filter(
          (feature) => feature.jointId === jointId,
        ),
      ],
      [thinAxis(selectedPanel)],
    )
  }
  const selectedTextShape: Extract<PanelShape, { type: 'text' }> | undefined =
    selectedPanel?.shape?.type === 'text'
      ? selectedPanel.shape
      : selectedPanel?.shape?.type === 'free' &&
          selectedPanel.shape.sourceType === 'text'
        ? {
            type: 'text',
            text: 'Text',
            fontFamily: bundledFontFamily,
            fontSize: Math.max(1, selectedPanel.size[1]),
            display: 'filled',
            operation: 'engrave-fill',
            outline: null,
            editedFaces: selectedPanel.shape.faces,
          }
        : undefined
  const selectedVertical = panels.find(
    (panel) => selected.includes(panel.id) && thinAxis(panel) !== 1,
  )
  const selectedBounds =
    selected.length > 1
      ? panels
          .filter((panel) => selected.includes(panel.id))
          .reduce(
            (bounds, panel) => {
              const half = worldHalfExtents(panel)
              return {
                min: bounds.min.map((value, axis) =>
                  Math.min(value, panel.position[axis] - half[axis]),
                ) as [number, number, number],
                max: bounds.max.map((value, axis) =>
                  Math.max(value, panel.position[axis] + half[axis]),
                ) as [number, number, number],
              }
            },
            {
              min: [Infinity, Infinity, Infinity] as [number, number, number],
              max: [-Infinity, -Infinity, -Infinity] as [
                number,
                number,
                number,
              ],
            },
          )
      : null
  const selectedCenter = selectedBounds
    ? (selectedBounds.min.map(
        (value, axis) => (value + selectedBounds.max[axis]) / 2,
      ) as [number, number, number])
    : null
  const booleanTarget =
    selected.length === 2
      ? panels.find((panel) => panel.id === selected[0])
      : undefined
  const booleanTool =
    selected.length === 2
      ? panels.find((panel) => panel.id === selected[1])
      : undefined
  const connectionAnalysis =
    booleanTarget && booleanTool
      ? analyzeConnection(booleanTarget, booleanTool)
      : undefined
  const displayedRotation =
    selectedPanel && rotationPreview?.panelId === selectedPanel.id
      ? rotationPreview.rotation
      : selectedPanel?.rotation
  const displayedPosition =
    selectedPanel && rotationPreview?.panelId === selectedPanel.id
      ? (rotationPreview.position ?? selectedPanel.position)
      : selectedPanel?.position
  const displayedSize =
    selectedPanel && rotationPreview?.panelId === selectedPanel.id
      ? (rotationPreview.size ?? selectedPanel.size)
      : selectedPanel?.size
  const selectedJointCount = fingerJoints.filter((joint) =>
    selected.length === 1
      ? joint.firstPanelId === selected[0] ||
        joint.secondPanelId === selected[0]
      : selected.length > 1 &&
        selected.includes(joint.firstPanelId) &&
        selected.includes(joint.secondPanelId),
  ).length
  const assignedMaterialIds = new Set(
    panels
      .filter((panel) => !selected.length || selected.includes(panel.id))
      .map((panel) => panel.materialId),
  )
  const assignedMaterialId =
    assignedMaterialIds.size === 1 ? [...assignedMaterialIds][0] : ''
  const selectedGroupColor = groups.find(
    (group) => group.id === selectedGroupId,
  )?.displayColor
  const selectedObjectColors = new Set(
    panels
      .filter((panel) => selected.includes(panel.id))
      .map((panel) => panel.displayColor)
      .filter(Boolean),
  )
  const selectionColor = selectedGroupId
    ? selectedGroupColor
    : selectedObjectColors.size === 1
      ? [...selectedObjectColors][0]
      : undefined
  const usedDisplayColors = [
    ...new Set(
      [
        ...panels.map((panel) => panel.displayColor),
        ...groups.map((group) => group.displayColor),
      ].filter((color): color is string => Boolean(color)),
    ),
  ].sort()
  const updateTextObject = async (
    changes: Partial<Extract<PanelShape, { type: 'text' }>>,
  ) => {
    if (!selectedPanel || !selectedTextShape) return
    const next = { ...selectedTextShape, ...changes }
    const geometryChanged =
      changes.text !== undefined ||
      changes.fontFamily !== undefined ||
      changes.fontSize !== undefined
    if (geometryChanged) next.editedFaces = undefined
    if (!geometryChanged) {
      updatePanelShape(selectedPanel.id, next)
      return
    }
    const outline =
      next.fontFamily === bundledFontFamily
        ? await createBundledTextOutline(next.text, next.fontSize)
        : await createSystemTextOutline(
            next.fontFamily,
            next.text,
            next.fontSize,
          )
    if (!outline) {
      if (
        changes.fontSize !== undefined &&
        selectedTextShape.outline &&
        selectedTextShape.fontSize > 0
      ) {
        const factor = next.fontSize / selectedTextShape.fontSize
        const scaledOutline = {
          ...selectedTextShape.outline,
          width: selectedTextShape.outline.width * factor,
          height: selectedTextShape.outline.height * factor,
          centerX: selectedTextShape.outline.centerX * factor,
          centerY: selectedTextShape.outline.centerY * factor,
          commands: selectedTextShape.outline.commands.map((command) =>
            command.type === 'Z'
              ? command
              : (Object.fromEntries(
                  Object.entries(command).map(([key, value]) => [
                    key,
                    key === 'type' ? value : Number(value) * factor,
                  ]),
                ) as typeof command),
          ),
        }
        updatePanelShape(selectedPanel.id, { ...next, outline: scaledOutline })
        resizePanel(selectedPanel.id, [
          scaledOutline.width,
          scaledOutline.height,
          selectedPanel.size[2],
        ])
        return
      }
      updatePanelShape(selectedPanel.id, next)
      return
    }
    updatePanelShape(selectedPanel.id, { ...next, outline })
    resizePanel(selectedPanel.id, [
      outline.width,
      outline.height,
      selectedPanel.size[2],
    ])
  }

  useEffect(() => {
    if (
      !connectionAnalysis ||
      connectionAnalysis.possible[
        connectionType === 'tab-slot' ? 'tabSlot' : connectionType
      ]
    )
      return
    if (connectionAnalysis.possible.finger) setConnectionType('finger')
    else if (connectionAnalysis.possible.tabSlot) setConnectionType('tab-slot')
    else if (connectionAnalysis.possible.cross) setConnectionType('cross')
  }, [
    connectionAnalysis?.possible.finger,
    connectionAnalysis?.possible.tabSlot,
    connectionAnalysis?.possible.cross,
    connectionType,
  ])

  useEffect(() => {
    if (
      !connectionBuilderOpen ||
      !booleanTarget ||
      !booleanTool ||
      !connectionAnalysis
    ) {
      setJointPreview(null)
      return
    }
    if (connectionType === 'cross') {
      const built = buildCrossJoint(
        booleanTarget,
        booleanTool,
        {
          ratio: crossRatio / 100,
          fit: fitPreset,
          clearance: customClearance,
          firstFromHigh: crossFirstFromHigh,
        },
        '__joint-preview__',
      )
      setJointPreview(
        'error' in built
          ? null
          : [
              {
                panelId: booleanTarget.id,
                cuts: [built.firstCut],
                features: built.firstFeatures,
                color: '#ff3158',
              },
              {
                panelId: booleanTool.id,
                cuts: [built.secondCut],
                features: built.secondFeatures,
                color: '#4da3ff',
              },
            ],
      )
      return
    }
    const built = buildFingerJoint(
      booleanTarget,
      booleanTool,
      {
        fingerWidth,
        fit: fitPreset,
        clearance: customClearance,
        style: fingerStyle,
        reliefDiameter,
      },
      '__joint-preview__',
    )
    const expectedType = connectionType === 'finger' ? 'corner' : 't-joint'
    setJointPreview(
      'error' in built || built.definition.connectionType !== expectedType
        ? null
        : [
            {
              panelId: booleanTarget.id,
              cuts: [],
              features: built.firstFeatures,
            },
            {
              panelId: booleanTool.id,
              cuts: [],
              features: built.secondFeatures,
            },
          ],
    )
  }, [
    connectionBuilderOpen,
    booleanTarget,
    booleanTool,
    connectionAnalysis,
    connectionType,
    crossRatio,
    crossFirstFromHigh,
    fingerWidth,
    fitPreset,
    customClearance,
    fingerStyle,
    reliefDiameter,
    setJointPreview,
  ])

  useEffect(() => () => setJointPreview(null), [setJointPreview])

  useEffect(() => {
    const material = materials.find(
      (candidate) => candidate.id === materialEditorId,
    )
    if (!material) return
    setMaterialName(material.name)
    setMaterialThickness(material.thickness)
    setMaterialKerf(material.kerf)
    setMaterialColor(material.color)
    setMaterialMinimumBackbone(material.minimumBackbone ?? 0)
    setMaterialMinimumWeb(material.minimumWeb ?? 0)
  }, [materialEditorId])

  useEffect(() => {
    if (
      !selectedPanel ||
      selectedPanel.shape?.type !== 'text' ||
      selectedPanel.shape.outline
    )
      return
    const textShape = selectedPanel.shape
    let cancelled = false
    void createBundledTextOutline(textShape.text, textShape.fontSize).then(
      (outline) => {
        if (cancelled || !outline) return
        updatePanelShape(selectedPanel.id, {
          ...textShape,
          fontFamily: bundledFontFamily,
          outline,
        })
        resizePanel(selectedPanel.id, [
          outline.width,
          outline.height,
          selectedPanel.size[2],
        ])
      },
    )
    return () => {
      cancelled = true
    }
  }, [resizePanel, selectedPanel?.id, selectedPanel?.shape, updatePanelShape])

  return (
    <aside className="properties-panel">
      <div className="panel-heading">
        <span>Eigenschaften</span>
        <Settings2 />
      </div>
      <div className="selection-card">
        <div className="selection-icon">
          <Ruler />
        </div>
        <div>
          <small>Aktuelle Auswahl</small>
          <strong>
            {selected.length
              ? `${selected.length} Objekt${selected.length > 1 ? 'e' : ''}`
              : 'Box 01'}
          </strong>
        </div>
      </div>
      {selectedPanel && (
        <SidebarAccordion
          key="geometry"
          id="geometry"
          title="Geometrie"
          className="object-geometry-editor"
        >
          <h4 className="shape-parameter-title">Position</h4>
          {(['X', 'Y', 'Z'] as const).map((axis, index) => (
            <label className="number-field" key={`position-${axis}`}>
              <span>{axis}</span>
              <div>
                <PositionInput
                  value={
                    displayedPosition?.[index] ?? selectedPanel.position[index]
                  }
                  onCommit={(value) => {
                    const position: [number, number, number] = [
                      ...selectedPanel.position,
                    ]
                    position[index] = value
                    setPanelPosition(selectedPanel.id, position)
                  }}
                />
                <em>mm</em>
              </div>
            </label>
          ))}
          <h4 className="shape-parameter-title">Rotation</h4>
          {(['X', 'Y', 'Z'] as const).map((axis, index) => (
            <label className="number-field" key={`rotation-${axis}`}>
              <span>{axis}</span>
              <div>
                <input
                  type="number"
                  step="1"
                  value={Number(
                    (
                      ((displayedRotation?.[index] ?? 0) * 180) /
                      Math.PI
                    ).toFixed(2),
                  )}
                  onChange={(event) => {
                    const rotation: [number, number, number] = [
                      ...selectedPanel.rotation,
                    ]
                    rotation[index] =
                      (Number(event.target.value) * Math.PI) / 180
                    rotatePanel(selectedPanel.id, rotation)
                  }}
                />
                <em>°</em>
              </div>
            </label>
          ))}
          <h4 className="shape-parameter-title">Größe</h4>
          {(['X', 'Y', 'Z'] as const)
            .filter((_, index) => index !== thinAxis(selectedPanel))
            .map((axis, visibleIndex) => {
              const index = ['X', 'Y', 'Z'].indexOf(axis)
              return (
                <label className="number-field" key={`size-${axis}`}>
                  <span>{visibleIndex === 0 ? 'Breite' : 'Höhe'}</span>
                  <div>
                    <DimensionInput
                      value={
                        displayedSize?.[index] ?? selectedPanel.size[index]
                      }
                      onCommit={(value) => {
                        const size: [number, number, number] = [
                          ...selectedPanel.size,
                        ]
                        size[index] = value
                        resizePanel(selectedPanel.id, size)
                      }}
                    />
                    <em>mm</em>
                  </div>
                </label>
              )
            })}
          {selectedPanel.shape && selectedPanel.shape.type !== 'rectangle' && (
            <h4 className="shape-parameter-title">
              Form ·{' '}
              {selectedPanel.shape.type === 'polygon'
                ? 'Vieleck'
                : selectedPanel.shape.type === 'star'
                  ? 'Stern'
                  : selectedPanel.shape.type === 'circle'
                    ? 'Kreis'
                    : selectedPanel.shape.type === 'text'
                      ? 'Text'
                      : selectedPanel.shape.type === 'free'
                        ? selectedPanel.shape.sourceType === 'text'
                          ? 'Text'
                          : 'Freie Kontur'
                        : 'Dreieck'}
            </h4>
          )}
          {selectedPanel.shape?.type === 'polygon' && (
            <label className="number-field">
              <span>Anzahl Seiten</span>
              <div>
                <input
                  type="number"
                  min="3"
                  max="64"
                  value={selectedPanel.shape.sides}
                  onChange={(event) =>
                    updatePanelShape(selectedPanel.id, {
                      type: 'polygon',
                      sides: Math.min(
                        64,
                        Math.max(3, Number(event.target.value)),
                      ),
                    })
                  }
                />
              </div>
            </label>
          )}
          {selectedPanel.shape?.type === 'circle' && (
            <label className="number-field">
              <span>Kreisauflösung</span>
              <div>
                <input
                  type="number"
                  min="16"
                  max="128"
                  step="8"
                  value={selectedPanel.shape.segments}
                  onChange={(event) =>
                    updatePanelShape(selectedPanel.id, {
                      type: 'circle',
                      segments: Math.min(
                        128,
                        Math.max(16, Number(event.target.value)),
                      ),
                    })
                  }
                />
              </div>
            </label>
          )}
          {selectedPanel.shape?.type === 'star' && (
            <>
              <label className="number-field">
                <span>Sternspitzen</span>
                <div>
                  <input
                    type="number"
                    min="3"
                    max="32"
                    value={selectedPanel.shape.points}
                    onChange={(event) =>
                      updatePanelShape(selectedPanel.id, {
                        type: 'star',
                        points: Math.min(
                          32,
                          Math.max(3, Number(event.target.value)),
                        ),
                        innerRatio:
                          selectedPanel.shape!.type === 'star'
                            ? selectedPanel.shape!.innerRatio
                            : 0.45,
                      })
                    }
                  />
                </div>
              </label>
              <label className="number-field">
                <span>Innenradius</span>
                <div>
                  <input
                    type="number"
                    min="10"
                    max="90"
                    value={Math.round(selectedPanel.shape.innerRatio * 100)}
                    onChange={(event) =>
                      updatePanelShape(selectedPanel.id, {
                        type: 'star',
                        points:
                          selectedPanel.shape!.type === 'star'
                            ? selectedPanel.shape!.points
                            : 5,
                        innerRatio: Math.min(
                          0.9,
                          Math.max(0.1, Number(event.target.value) / 100),
                        ),
                      })
                    }
                  />
                  <em>%</em>
                </div>
              </label>
            </>
          )}
        </SidebarAccordion>
      )}
      {selectedPanel && selectedTextShape && (
        <SidebarAccordion
          key="text"
          id="text"
          title="Text"
          className="text-shape-parameters"
        >
          <label className="property-text-field">
            <span>Inhalt</span>
            <input
              value={selectedTextShape.text}
              onChange={(event) =>
                void updateTextObject({ text: event.target.value })
              }
            />
          </label>
          <label className="property-text-field">
            <span>Schriftart</span>
            <SystemFontPicker
              fonts={systemFonts}
              value={selectedTextShape.fontFamily || 'Schrift auswählen…'}
              onChange={(fontFamily) => void updateTextObject({ fontFamily })}
              onLoad={async () =>
                setSystemFonts(await listInstalledSystemFonts())
              }
            />
          </label>
          <label className="number-field">
            <span>Schriftgröße</span>
            <div>
              <input
                type="number"
                min="1"
                value={selectedTextShape.fontSize}
                onChange={(event) =>
                  void updateTextObject({
                    fontSize: Math.max(1, Number(event.target.value)),
                  })
                }
              />
              <em>mm</em>
            </div>
          </label>
          <label className="select-field">
            <span>Darstellung</span>
            <select
              value={selectedTextShape.display ?? 'filled'}
              onChange={(event) =>
                void updateTextObject({
                  display: event.target.value as 'filled' | 'outline',
                })
              }
            >
              <option value="filled">Gefüllt</option>
              <option value="outline">Umriss</option>
            </select>
          </label>
        </SidebarAccordion>
      )}
      {selected.length > 0 && (
        <SidebarAccordion
          key="object-color"
          id="object-color"
          title={selectedGroupId ? 'Baugruppenfarbe' : 'Objektfarbe'}
          className="object-color-editor"
          defaultOpen={false}
        >
          <label className="material-color">
            <span>Darstellung im 3D-Editor</span>
            <input
              type="color"
              value={selectionColor ?? '#4f7cff'}
              onChange={(event) => setSelectionColor(event.target.value)}
            />
          </label>
          <label className="number-field">
            <span>Mindestrücken hinter Steckschlitzen</span>
            <div>
              <input
                type="number"
                min="0"
                step="0.1"
                value={materialMinimumBackbone}
                onChange={(event) =>
                  setMaterialMinimumBackbone(
                    Math.max(0, Number(event.target.value)),
                  )
                }
              />
              <em>mm</em>
            </div>
          </label>
          <label className="number-field">
            <span>Mindeststeg zwischen Steckschlitzen</span>
            <div>
              <input
                type="number"
                min="0"
                step="0.1"
                value={materialMinimumWeb}
                onChange={(event) =>
                  setMaterialMinimumWeb(Math.max(0, Number(event.target.value)))
                }
              />
              <em>mm</em>
            </div>
          </label>
          {usedDisplayColors.length > 0 && (
            <div className="used-color-palette">
              <span>Bereits verwendet</span>
              <div>
                {usedDisplayColors.map((color) => (
                  <button
                    type="button"
                    key={color}
                    className={selectionColor === color ? 'active' : ''}
                    style={{ '--swatch-color': color } as CSSProperties}
                    title={`${color} übernehmen`}
                    aria-label={`${color} übernehmen`}
                    onClick={() => setSelectionColor(color)}
                  />
                ))}
              </div>
            </div>
          )}
          <button
            type="button"
            className="snap-toggle"
            disabled={!selectionColor}
            onClick={() => setSelectionColor(undefined)}
          >
            Materialfarbe verwenden
          </button>
        </SidebarAccordion>
      )}
      {booleanTarget && booleanTool && (
        <SidebarAccordion
          key="boolean"
          id="boolean"
          title="Vereinen & Ausschneiden"
          className="boolean-builder"
        >
          <div className="boolean-operands">
            <div>
              <small>Zielkörper</small>
              <strong title={booleanTarget.label}>{booleanTarget.label}</strong>
            </div>
            <button
              title="Ziel und Werkzeug vertauschen"
              onClick={swapSelectionOrder}
            >
              <ArrowDownUp />
            </button>
            <div>
              <small>Werkzeug</small>
              <strong title={booleanTool.label}>{booleanTool.label}</strong>
            </div>
          </div>
          <label className="boolean-operation">
            <span>Operation</span>
            <select
              value={booleanOperation}
              onChange={(event) =>
                setBooleanOperation(event.target.value as BooleanOperation)
              }
            >
              {Object.entries(booleanLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button
            className="apply-boolean"
            onClick={() => applyBoolean(booleanOperation)}
          >
            Anwenden
          </button>
        </SidebarAccordion>
      )}
      {booleanTarget && booleanTool && connectionAnalysis && (
        <SidebarAccordion
          key="connection-builder"
          id="connection-builder"
          title="Teile verbinden"
          className="finger-joint-builder connection-builder"
          onOpenChange={setConnectionBuilderOpen}
        >
          <p className="connection-builder-intro">
            Wähle die Verbindungsart und prüfe die Vorschau direkt am Modell.
          </p>
          <div className="joint-order">
            <div>
              <small>
                {connectionType === 'cross'
                  ? `1 · Schlitz von ${crossFirstFromHigh ? 'oben' : 'unten'}`
                  : connectionType === 'tab-slot'
                    ? '1 · Anstoßendes Teil'
                    : '1 · Finger beginnen'}
              </small>
              <strong title={booleanTarget.label}>{booleanTarget.label}</strong>
            </div>
            <button
              title={
                connectionType === 'cross'
                  ? 'Öffnungsrichtung wechseln'
                  : 'Reihenfolge vertauschen'
              }
              onClick={() =>
                connectionType === 'cross'
                  ? setCrossFirstFromHigh((value) => !value)
                  : swapSelectionOrder()
              }
            >
              <ArrowDownUp />
            </button>
            <div>
              <small>
                {connectionType === 'cross'
                  ? `2 · Schlitz von ${crossFirstFromHigh ? 'unten' : 'oben'}`
                  : connectionType === 'tab-slot'
                    ? '2 · Durchlaufendes Teil'
                    : '2 · Gegenfinger'}
              </small>
              <strong title={booleanTool.label}>{booleanTool.label}</strong>
            </div>
          </div>
          <label className="select-field">
            <span>Verbindungsart</span>
            <select
              value={connectionType}
              onChange={(event) =>
                setConnectionType(event.target.value as typeof connectionType)
              }
            >
              <option
                value="finger"
                disabled={!connectionAnalysis.possible.finger}
              >
                Fingerzinken
              </option>
              <option
                value="tab-slot"
                disabled={!connectionAnalysis.possible.tabSlot}
              >
                Zapfen &amp; Schlitz
              </option>
              <option
                value="cross"
                disabled={!connectionAnalysis.possible.cross}
              >
                Steckkreuz
              </option>
            </select>
          </label>
          <small className="connection-analysis">
            {connectionAnalysis.message}
          </small>
          {connectionType !== 'cross' && (
            <label className="number-field">
              <span>
                {connectionType === 'finger' ? 'Fingerbreite' : 'Zapfenbreite'}
              </span>
              <div>
                <input
                  type="number"
                  min="2"
                  step="1"
                  value={fingerWidth}
                  onChange={(event) =>
                    setFingerWidth(Math.max(2, Number(event.target.value)))
                  }
                />
                <em>mm</em>
              </div>
            </label>
          )}
          {connectionType === 'cross' && (
            <label className="number-field">
              <span>Schlitztiefe Teil 1</span>
              <div>
                <input
                  type="number"
                  min="10"
                  max="90"
                  step="5"
                  value={crossRatio}
                  onChange={(event) =>
                    setCrossRatio(
                      Math.min(90, Math.max(10, Number(event.target.value))),
                    )
                  }
                />
                <em>%</em>
              </div>
            </label>
          )}
          {connectionType === 'cross' && (
            <small className="boolean-help">
              Teil 1: {crossRatio}% von {crossFirstFromHigh ? 'oben' : 'unten'}{' '}
              · Teil 2: {100 - crossRatio}% von{' '}
              {crossFirstFromHigh ? 'unten' : 'oben'}.
            </small>
          )}
          {connectionType === 'cross' && (
            <small className="connection-preview-legend">
              <i className="first" /> Teil 1 · Schlitz von{' '}
              {crossFirstFromHigh ? 'oben' : 'unten'} <i className="second" />{' '}
              Teil 2 · Schlitz von {crossFirstFromHigh ? 'unten' : 'oben'}
            </small>
          )}
          <label className="select-field">
            <span>Passung</span>
            <select
              value={fitPreset}
              onChange={(event) =>
                setFitPreset(event.target.value as FitPreset)
              }
            >
              <option value="press">Press · −0,12 mm</option>
              <option value="tight">Eng · 0,00 mm</option>
              <option value="loose">Locker · +0,20 mm</option>
              <option value="custom">Benutzerdefiniert</option>
            </select>
          </label>
          {fitPreset === 'custom' && (
            <label className="number-field">
              <span>Spiel</span>
              <div>
                <input
                  type="number"
                  step="0.01"
                  value={customClearance}
                  onChange={(event) =>
                    setCustomClearance(Number(event.target.value))
                  }
                />
                <em>mm</em>
              </div>
            </label>
          )}
          {connectionType !== 'cross' && (
            <label className="select-field">
              <span>Ecken</span>
              <select
                value={fingerStyle}
                onChange={(event) =>
                  setFingerStyle(event.target.value as FingerStyle)
                }
              >
                <option value="straight">Gerade</option>
                <option value="dogbone">Dogbone · Eckbohrungen</option>
                <option value="t-bone">T-Bone · mittige Entlastung</option>
              </select>
            </label>
          )}
          {connectionType !== 'cross' && fingerStyle !== 'straight' && (
            <label className="number-field">
              <span>Bohrungs-Ø</span>
              <div>
                <input
                  type="number"
                  min="0.2"
                  step="0.1"
                  value={reliefDiameter}
                  onChange={(event) =>
                    setReliefDiameter(Math.max(0.2, Number(event.target.value)))
                  }
                />
                <em>mm</em>
              </div>
            </label>
          )}
          <button
            className="apply-joint"
            onClick={() =>
              connectionType === 'cross'
                ? createCrossJoint({
                    ratio: crossRatio / 100,
                    fit: fitPreset,
                    clearance: customClearance,
                    firstFromHigh: crossFirstFromHigh,
                  })
                : createFingerJoint({
                    connectionType,
                    fingerWidth,
                    fit: fitPreset,
                    clearance: customClearance,
                    style: fingerStyle,
                    reliefDiameter,
                  })
            }
          >
            Verbindung jetzt erstellen
          </button>
          {selectedJointCount > 0 && (
            <button
              className="remove-selected-joints"
              onClick={removeFingerJointsFromSelection}
            >
              Finger zwischen Auswahl entfernen · {selectedJointCount}
            </button>
          )}
        </SidebarAccordion>
      )}
      {selected.length > 1 && (
        <SidebarAccordion
          key="selection-transform"
          id="selection-transform"
          title="Position & Größe"
          className="selection-transform"
        >
          {selectedCenter && (
            <>
              <h4 className="shape-parameter-title">
                Auswahl gemeinsam verschieben
              </h4>
              {(['X', 'Y', 'Z'] as const).map((axis, index) => (
                <label
                  className="number-field"
                  key={`selection-position-${axis}`}
                >
                  <span>{axis}</span>
                  <div>
                    <PositionInput
                      value={selectedCenter[index]}
                      onCommit={(value) => {
                        const position: [number, number, number] = [
                          ...selectedCenter,
                        ]
                        position[index] = value
                        setSelectionPosition(position)
                      }}
                    />
                    <em>mm</em>
                  </div>
                </label>
              ))}
            </>
          )}
          {selectedVertical ? (
            <>
              <label className="number-field">
                <span>Höhe</span>
                <div>
                  <input
                    type="number"
                    min="1"
                    value={selectedVertical.size[1]}
                    onChange={(event) =>
                      setSelectionHeight(
                        Math.max(1, Number(event.target.value)),
                      )
                    }
                  />
                  <em>mm</em>
                </div>
              </label>
            </>
          ) : null}
        </SidebarAccordion>
      )}
      {selectedPanel && geometrySelectionMode !== 'object' && (
        <SidebarAccordion
          id="contour-edit"
          key="contour-edit"
          className="contour-editor"
          title={
            geometrySelectionMode === 'face'
              ? 'Flächenbearbeitung'
              : 'Kantenbearbeitung'
          }
        >
          <small className="property-help">
            {geometrySelectionMode === 'face'
              ? 'Klicke auf eine Seitenfläche, um die zugehörige Konturseite zu verschieben.'
              : 'Klicke auf einen Eckpunkt, um diese Kante einzeln zu verschieben.'}
          </small>
          {contourSelection?.panelId === selectedPanel.id && (
            <div className="contour-move">
              <label className="number-field">
                <span>Verschiebung X</span>
                <div>
                  <input
                    type="number"
                    step="0.1"
                    value={contourX}
                    onChange={(event) =>
                      setContourX(Number(event.target.value))
                    }
                  />
                  <em>mm</em>
                </div>
              </label>
              <label className="number-field">
                <span>Verschiebung Y</span>
                <div>
                  <input
                    type="number"
                    step="0.1"
                    value={contourY}
                    onChange={(event) =>
                      setContourY(Number(event.target.value))
                    }
                  />
                  <em>mm</em>
                </div>
              </label>
              <button
                type="button"
                onClick={() => moveSelectedContour([contourX, contourY])}
              >
                Auswahl verschieben
              </button>
            </div>
          )}
        </SidebarAccordion>
      )}
      {selectedPanel &&
        socketPatterns.length < 0 &&
        geometrySelectionMode === 'object' && (
          <SidebarAccordion
            key="socket-patterns"
            id="socket-patterns"
            title={`Freie Aufnahmen · ${socketPatterns.filter((pattern) => pattern.panelId === selectedPanel!.id).length}`}
            className="socket-patterns"
          >
            <small className="property-help">
              Erzeugt unabhängige Steckplätze ohne vorhandenes Gegenbauteil.
            </small>
            <div className="profile-parameter-grid">
              <label className="number-field compact">
                <span>Anzahl</span>
                <div>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={socketCount}
                    onChange={(event) =>
                      setSocketCount(Math.max(1, Number(event.target.value)))
                    }
                  />
                </div>
              </label>
              <label className="number-field compact">
                <span>Verteilspanne</span>
                <div>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={socketSpan}
                    onChange={(event) =>
                      setSocketSpan(Number(event.target.value))
                    }
                  />
                  <em>mm</em>
                </div>
              </label>
              <label className="number-field compact">
                <span>Aufnahmelänge</span>
                <div>
                  <input
                    type="number"
                    min="0.1"
                    step="1"
                    value={socketLength}
                    onChange={(event) =>
                      setSocketLength(Math.max(0.1, Number(event.target.value)))
                    }
                  />
                  <em>mm</em>
                </div>
              </label>
              <label className="number-field compact">
                <span>Spiel</span>
                <div>
                  <input
                    type="number"
                    step="0.01"
                    value={socketClearance}
                    onChange={(event) =>
                      setSocketClearance(Number(event.target.value))
                    }
                  />
                  <em>mm</em>
                </div>
              </label>
            </div>
            <label className="select-field">
              <span>Zielmaterial des späteren Trenners</span>
              <select
                value={socketMaterialId}
                onChange={(event) => setSocketMaterialId(event.target.value)}
              >
                {materials.map((material) => (
                  <option key={material.id} value={material.id}>
                    {material.name} · {material.thickness} mm
                  </option>
                ))}
              </select>
            </label>
            <button
              className="apply-joint"
              onClick={() =>
                createSocketPattern({
                  count: socketCount,
                  span: socketSpan,
                  slotLength: socketLength,
                  targetThickness:
                    materials.find(
                      (material) => material.id === socketMaterialId,
                    )?.thickness ?? 3,
                  clearance: socketClearance,
                })
              }
            >
              Aufnahmen automatisch verteilen
            </button>
            {socketPatterns
              .filter((pattern) => pattern.panelId === selectedPanel!.id)
              .map((pattern) => (
                <details key={pattern.id} open>
                  <summary>
                    <span>{pattern.name}</span>
                    <button
                      onClick={(event) => {
                        event.preventDefault()
                        removeSocketPattern(pattern.id)
                      }}
                    >
                      Entfernen
                    </button>
                  </summary>
                  {pattern.instances.map((instance, index) => (
                    <div className="socket-instance" key={instance.id}>
                      <span>Aufnahme {index + 1}</span>
                      <label className="number-field compact">
                        <span>Position</span>
                        <div>
                          <input
                            type="number"
                            step="0.5"
                            disabled={instance.deleted}
                            value={Number(
                              (instance.basePosition + instance.offset).toFixed(
                                2,
                              ),
                            )}
                            onChange={(event) =>
                              updateSocketInstance(pattern.id, instance.id, {
                                offset:
                                  Number(event.target.value) -
                                  instance.basePosition,
                              })
                            }
                          />
                          <em>mm</em>
                        </div>
                      </label>
                      <button
                        className="secondary"
                        onClick={() =>
                          updateSocketInstance(pattern.id, instance.id, {
                            offset: instance.deleted ? instance.offset : 0,
                            deleted: !instance.deleted,
                          })
                        }
                      >
                        {instance.deleted ? 'Wiederherstellen' : 'Löschen'}
                      </button>
                      {!instance.deleted && instance.offset !== 0 && (
                        <button
                          className="secondary"
                          onClick={() =>
                            updateSocketInstance(pattern.id, instance.id, {
                              offset: 0,
                            })
                          }
                        >
                          Zurücksetzen
                        </button>
                      )}
                    </div>
                  ))}
                  <label className="select-field">
                    <span>Auf anderes Teil übertragen</span>
                    <select
                      value={socketTargetPanelId}
                      onChange={(event) =>
                        setSocketTargetPanelId(event.target.value)
                      }
                    >
                      <option value="">Zielfläche wählen …</option>
                      {panels
                        .filter((panel) => panel.id !== selectedPanel!.id)
                        .map((panel) => (
                          <option key={panel.id} value={panel.id}>
                            {panel.label}
                          </option>
                        ))}
                    </select>
                  </label>
                  <div className="button-row">
                    <button
                      disabled={!socketTargetPanelId}
                      onClick={() =>
                        transferSocketPattern(
                          pattern.id,
                          socketTargetPanelId,
                          'copy',
                        )
                      }
                    >
                      Identisch kopieren
                    </button>
                    <button
                      disabled={!socketTargetPanelId}
                      onClick={() =>
                        transferSocketPattern(
                          pattern.id,
                          socketTargetPanelId,
                          'mirror',
                        )
                      }
                    >
                      Spiegeln
                    </button>
                  </div>
                </details>
              ))}
          </SidebarAccordion>
        )}
      {selectedPanel && selectedPanel.cuts.length > 0 && (
        <SidebarAccordion
          key="cuts"
          id="cuts"
          title={`Aussparungen · ${selectedPanel.cuts.length}`}
          className="cut-list"
        >
          {selectedPanel.cuts.map((cut, cutIndex) => {
            const socketPattern = cut.socketPatternId
              ? socketPatterns.find(
                  (pattern) => pattern.id === cut.socketPatternId,
                )
              : undefined
            const socketInstance = socketPattern?.instances.find(
              (instance) => instance.id === cut.socketInstanceId,
            )
            return (
              <details
                key={cut.id}
                open={selectedPanel.cuts.length === 1}
                className={
                  inspectionFocus?.sourceId === cut.id ? 'focused-entry' : ''
                }
              >
                <summary
                  title="Aussparung im Modell anzeigen"
                  onClick={() => focusRegion(cut.id, [cut], true)}
                >
                  <span>
                    {socketPattern?.socketType === 'cross'
                      ? 'Kreuzsteckaufnahme'
                      : socketPattern
                        ? 'Freie Steckaufnahme'
                        : cut.kind === 'half-lap'
                          ? '50/50-Steckschlitz'
                          : 'Rechteckiger Durchbruch'}{' '}
                    {cutIndex + 1}
                  </span>
                  <button
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      if (socketPattern && socketInstance)
                        updateSocketInstance(
                          socketPattern.id,
                          socketInstance.id,
                          { deleted: true },
                        )
                      else removeCut(selectedPanel.id, cut.id)
                    }}
                  >
                    Entfernen
                  </button>
                </summary>
                {socketPattern && socketInstance ? (
                  <>
                    <small className="property-help">
                      {socketPattern.name} ·{' '}
                      {socketPattern.socketType === 'cross'
                        ? `${socketPattern.entrySide === 'negative' ? 'Kante B' : 'Kante A'} · ${Math.round((socketPattern.depthRatio ?? 0.5) * 100)} % Tiefe`
                        : `${socketPattern.slotLength.toFixed(1)} mm Länge`}
                    </small>
                    <label className="number-field compact">
                      <span>
                        {socketPattern.distributionAxis === 0
                          ? 'Abstand von linker Kante'
                          : socketPattern.distributionAxis === 1
                            ? 'Abstand von unterer Kante'
                            : 'Abstand von vorderer Kante'}
                      </span>
                      <div>
                        <input
                          type="number"
                          min="0"
                          max={
                            selectedPanel.size[socketPattern.distributionAxis]
                          }
                          step="0.5"
                          value={Number(
                            (
                              socketInstance.basePosition +
                              socketInstance.offset +
                              selectedPanel.size[
                                socketPattern.distributionAxis
                              ] /
                                2
                            ).toFixed(2),
                          )}
                          onChange={(event) =>
                            updateSocketInstance(
                              socketPattern.id,
                              socketInstance.id,
                              {
                                offset:
                                  Number(event.target.value) -
                                  selectedPanel.size[
                                    socketPattern.distributionAxis
                                  ] /
                                    2 -
                                  socketInstance.basePosition,
                              },
                            )
                          }
                        />
                        <em>mm</em>
                      </div>
                    </label>
                  </>
                ) : (
                  <>
                    <h4>Position im Teil</h4>
                    {(['X', 'Y', 'Z'] as const).map((axis, index) => (
                      <label
                        className="number-field compact"
                        key={`center-${axis}`}
                      >
                        <span>{axis}</span>
                        <div>
                          <input
                            type="number"
                            step="1"
                            value={Number(cut.center[index].toFixed(2))}
                            onChange={(event) =>
                              updateCut(
                                selectedPanel.id,
                                cut.id,
                                'center',
                                index as 0 | 1 | 2,
                                Number(event.target.value),
                              )
                            }
                          />
                          <em>mm</em>
                        </div>
                      </label>
                    ))}
                    <h4>Größe des Schnitts</h4>
                    {(['X', 'Y', 'Z'] as const).map((axis, index) => (
                      <label
                        className="number-field compact"
                        key={`size-${axis}`}
                      >
                        <span>{axis}</span>
                        <div>
                          <input
                            type="number"
                            min="0.1"
                            step="1"
                            value={Number(cut.size[index].toFixed(2))}
                            onChange={(event) =>
                              updateCut(
                                selectedPanel.id,
                                cut.id,
                                'size',
                                index as 0 | 1 | 2,
                                Number(event.target.value),
                              )
                            }
                          />
                          <em>mm</em>
                        </div>
                      </label>
                    ))}
                  </>
                )}
              </details>
            )
          })}
        </SidebarAccordion>
      )}
      {selectedPanel && selectedPanel.booleanModifiers.length > 0 && (
        <SidebarAccordion
          key="modifier-stack"
          id="modifier-stack"
          title={`Formkombinationen · ${selectedPanel.booleanModifiers.length}`}
          className="modifier-stack"
        >
          {selectedPanel.booleanModifiers.map((modifier, index) => {
            const tool = panels.find((panel) => panel.id === modifier.toolId)
            return (
              <div className="modifier-card" key={modifier.id}>
                <div className="modifier-head">
                  <span>{index + 1}</span>
                  <strong>{tool?.label ?? 'Fehlendes Werkzeug'}</strong>
                  <button
                    onClick={() => removeBoolean(selectedPanel.id, modifier.id)}
                  >
                    Entfernen
                  </button>
                </div>
                <select
                  value={modifier.operation}
                  onChange={(event) =>
                    updateBoolean(
                      selectedPanel.id,
                      modifier.id,
                      event.target.value as BooleanOperation,
                    )
                  }
                >
                  {Object.entries(booleanLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                {tool && (
                  <button
                    className="edit-tool"
                    onClick={() => selectPanel(tool.id)}
                  >
                    Werkzeug bearbeiten
                  </button>
                )}
              </div>
            )
          })}
        </SidebarAccordion>
      )}
      {selectedPanel &&
        (fingerJoints.some(
          (joint) =>
            joint.firstPanelId === selectedPanel.id ||
            joint.secondPanelId === selectedPanel.id,
        ) ||
          crossJoints.some(
            (joint) =>
              joint.firstPanelId === selectedPanel.id ||
              joint.secondPanelId === selectedPanel.id,
          )) && (
          <SidebarAccordion
            key="joints"
            id="joints"
            title="Verbindungen"
            className="joint-stack"
          >
            {fingerJoints
              .filter(
                (joint) =>
                  joint.firstPanelId === selectedPanel.id ||
                  joint.secondPanelId === selectedPanel.id,
              )
              .map((joint) => {
                const otherId =
                  joint.firstPanelId === selectedPanel.id
                    ? joint.secondPanelId
                    : joint.firstPanelId
                const other = panels.find((panel) => panel.id === otherId)
                return (
                  <div
                    className={`joint-card${inspectionFocus?.sourceId === joint.id ? ' focused-entry' : ''}`}
                    key={joint.id}
                    role="button"
                    tabIndex={0}
                    title="Verbindung im Modell anzeigen"
                    onClick={() => focusJoint(joint.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ')
                        focusJoint(joint.id)
                    }}
                  >
                    <div>
                      <strong>
                        {joint.connectionType === 'corner'
                          ? 'Eckverbindung'
                          : 'T-Verbindung'}
                      </strong>
                      <small>
                        {other?.label} · {joint.fingerWidth.toFixed(1)} mm ·{' '}
                        {joint.fit}
                      </small>
                    </div>
                    <button
                      onClick={(event) => {
                        event.stopPropagation()
                        removeFingerJoint(joint.id)
                      }}
                    >
                      Entfernen
                    </button>
                  </div>
                )
              })}
            {crossJoints
              .filter(
                (joint) =>
                  joint.firstPanelId === selectedPanel.id ||
                  joint.secondPanelId === selectedPanel.id,
              )
              .map((joint) => {
                const otherId =
                  joint.firstPanelId === selectedPanel.id
                    ? joint.secondPanelId
                    : joint.firstPanelId
                const other = panels.find((panel) => panel.id === otherId)
                return (
                  <div
                    className={`joint-card${inspectionFocus?.sourceId === joint.id ? ' focused-entry' : ''}`}
                    key={joint.id}
                    role="button"
                    tabIndex={0}
                    title="Verbindung im Modell anzeigen"
                    onClick={() => focusJoint(joint.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ')
                        focusJoint(joint.id)
                    }}
                  >
                    <div>
                      <strong>Steckkreuz</strong>
                      <small>
                        {other?.label} · {Math.round(joint.ratio * 100)}/
                        {Math.round((1 - joint.ratio) * 100)} · {joint.fit}
                      </small>
                    </div>
                    <button
                      onClick={(event) => {
                        event.stopPropagation()
                        removeCrossJoint(joint.id)
                      }}
                    >
                      Entfernen
                    </button>
                  </div>
                )
              })}
            {fingerJoints.some(
              (joint) =>
                joint.firstPanelId === selectedPanel.id ||
                joint.secondPanelId === selectedPanel.id,
            ) && (
              <button
                className="remove-all-part-joints"
                onClick={removeFingerJointsFromSelection}
              >
                Alle Finger dieses Teils entfernen
              </button>
            )}
          </SidebarAccordion>
        )}
      {!selected.length && (
        <SidebarAccordion
          key="box-dimensions"
          id="box-dimensions"
          title="Gesamte Box · Abmessungen"
        >
          {fields.slice(0, 3).map((field) => (
            <label className="number-field" key={field.key}>
              <span>{field.label}</span>
              <div>
                <input
                  type="number"
                  min={field.min}
                  step="1"
                  value={box[field.key]}
                  onChange={(event) =>
                    setDimension(
                      field.key,
                      Math.max(field.min, Number(event.target.value)),
                    )
                  }
                />
                <em>mm</em>
              </div>
            </label>
          ))}
        </SidebarAccordion>
      )}
      {!selected.length && (
        <SidebarAccordion
          key="box-construction"
          id="box-construction"
          title="Gesamte Box · Konstruktion"
        >
          {fields.slice(3).map((field) => (
            <label className="number-field" key={field.key}>
              <span>{field.label}</span>
              <div>
                <input
                  type="number"
                  min={field.min}
                  step="0.1"
                  value={box[field.key]}
                  onChange={(event) =>
                    setDimension(
                      field.key,
                      Math.max(field.min, Number(event.target.value)),
                    )
                  }
                />
                <em>mm</em>
              </div>
            </label>
          ))}
          <label className="select-field">
            <span>Verbindung</span>
            <select defaultValue="finger">
              <option value="finger">Fingerzinken</option>
              <option value="butt">Stoßkante</option>
            </select>
          </label>
        </SidebarAccordion>
      )}
      <SidebarAccordion
        key="material"
        id="material"
        title="Material"
        className="material-editor"
        defaultOpen={false}
      >
        <>
          <label className="select-field">
            <span>
              {selected.length
                ? 'Material der Auswahl'
                : 'Material der gesamten Box'}
            </span>
            <select
              value={assignedMaterialId ?? ''}
              onChange={(event) => assignMaterial(event.target.value)}
            >
              <option value="" disabled>
                {assignedMaterialIds.size > 1
                  ? 'Mehrere Materialien'
                  : 'Material wählen'}
              </option>
              {materials.map((material) => (
                <option key={material.id} value={material.id}>
                  {material.name} · {material.thickness} mm
                </option>
              ))}
            </select>
          </label>
        </>
        <details className="material-library">
          <summary>Materialbibliothek bearbeiten</summary>
          <label className="select-field">
            <span>Eintrag</span>
            <select
              value={materialEditorId}
              onChange={(event) => setMaterialEditorId(event.target.value)}
            >
              {materials.map((material) => (
                <option key={material.id} value={material.id}>
                  {material.name} · {material.thickness} mm
                </option>
              ))}
            </select>
          </label>
          <label className="number-field text-field">
            <span>Name</span>
            <div>
              <input
                type="text"
                value={materialName}
                onChange={(event) => setMaterialName(event.target.value)}
              />
            </div>
          </label>
          <label className="number-field">
            <span>Materialstärke</span>
            <div>
              <input
                type="number"
                min="0.1"
                step="0.1"
                value={materialThickness}
                onChange={(event) =>
                  setMaterialThickness(
                    Math.max(0.1, Number(event.target.value)),
                  )
                }
              />
              <em>mm</em>
            </div>
          </label>
          <label className="number-field">
            <span>Schnittfuge</span>
            <div>
              <input
                type="number"
                min="0"
                step="0.01"
                value={materialKerf}
                onChange={(event) =>
                  setMaterialKerf(Math.max(0, Number(event.target.value)))
                }
              />
              <em>mm</em>
            </div>
          </label>
          <label className="material-color">
            <span>Farbe</span>
            <input
              type="color"
              value={materialColor}
              onChange={(event) => setMaterialColor(event.target.value)}
            />
          </label>
          <div className="material-actions">
            <button
              onClick={() =>
                updateMaterial(materialEditorId, {
                  name: materialName.trim() || 'Material',
                  thickness: materialThickness,
                  kerf: materialKerf,
                  color: materialColor,
                  minimumBackbone: materialMinimumBackbone || undefined,
                  minimumWeb: materialMinimumWeb || undefined,
                })
              }
            >
              Änderungen speichern
            </button>
            <button
              onClick={() =>
                addMaterial({
                  name: materialName.trim() || 'Material',
                  thickness: materialThickness,
                  kerf: materialKerf,
                  color: materialColor,
                  minimumBackbone: materialMinimumBackbone || undefined,
                  minimumWeb: materialMinimumWeb || undefined,
                })
              }
            >
              Als neues Material
            </button>
          </div>
        </details>
      </SidebarAccordion>
      {selectedPanel && (
        <SidebarAccordion
          key="processing"
          id="processing"
          title="Laserbearbeitung"
          className="processing-editor"
          defaultOpen={false}
        >
          <label className="processing-auto-cut">
            <input
              type="checkbox"
              checked={selectedPanel.autoCut !== false}
              onChange={(event) =>
                setPanelAutoCut(selectedPanel.id, event.target.checked)
              }
            />
            <span>
              <strong>Automatische Schnittkonturen</strong>
              <small>
                Außenkante und Aussparungen werden erkannt; Innenschnitte laufen
                automatisch zuerst.
              </small>
            </span>
          </label>
          {selectedPanel.autoCut === false && (
            <small className="processing-excluded">
              Dieses Objekt wird nicht automatisch ausgeschnitten.
            </small>
          )}
          <div className="processing-assignments">
            <h4>Zusätzliche Bearbeitungen</h4>
            {(selectedPanel.processingAssignments ?? []).map((assignment) => {
              const profile = processingProfiles.find(
                (candidate) => candidate.id === assignment.profileId,
              )
              return (
                <div key={assignment.id} className="processing-assignment">
                  <i style={{ background: profile?.color ?? '#777' }} />
                  <span>
                    <strong>{profile?.name ?? 'Fehlendes Profil'}</strong>
                    <small>
                      {assignment.geometry === 'fill' ? 'Fläche' : 'Kontur'}
                      {profile?.referenceDepth !== undefined
                        ? ` · Ziel ca. ${profile.referenceDepth} mm`
                        : ''}
                    </small>
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      removeProcessingAssignment(
                        selectedPanel.id,
                        assignment.id,
                      )
                    }
                  >
                    Entfernen
                  </button>
                </div>
              )
            })}
          </div>
          <label className="select-field">
            <span>Bearbeitungsprofil hinzufügen</span>
            <select
              value=""
              onChange={(event) => {
                if (event.target.value)
                  addProcessingAssignment(selectedPanel.id, event.target.value)
              }}
            >
              <option value="">Profil wählen…</option>
              {processingProfiles
                .filter(
                  (profile) =>
                    !(selectedPanel.processingAssignments ?? []).some(
                      (assignment) => assignment.profileId === profile.id,
                    ),
                )
                .sort((a, b) => a.order - b.order)
                .map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name} ·{' '}
                    {profile.geometry === 'fill' ? 'Fläche' : 'Kontur'}
                  </option>
                ))}
            </select>
          </label>
          <button
            className="manage-processing-profiles"
            type="button"
            onClick={() => setProfileDialogOpen(true)}
          >
            Bearbeitungsprofile verwalten
          </button>
          <small className="property-help">
            Profile beschreiben die gewünschte Bearbeitung. Dasselbe Objekt kann
            mehrere Profile erhalten.
          </small>
        </SidebarAccordion>
      )}
      {selected.length > 0 && (
        <div className="selection-actions">
          <button
            className="secondary-button"
            onClick={() => selectPanel(null)}
          >
            Auswahl aufheben
          </button>
          <button className="delete-button" onClick={removeSelected}>
            Ausgewählte Teile löschen
          </button>
        </div>
      )}
      {profileDialogOpen && (
        <ProcessingProfileDialog onClose={() => setProfileDialogOpen(false)} />
      )}
    </aside>
  )
}
