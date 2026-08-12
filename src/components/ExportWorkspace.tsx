import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import {
  ArrowDown,
  ArrowUp,
  Download,
  Eye,
  Maximize2,
  Minus,
  Plus,
  X,
} from 'lucide-react'
import {
  getExportWorkerClient,
  type ExportAnalysis,
  type ExportWorkerPayload,
} from '../model/exportWorkerClient'
import { useEditor } from '../store/editor'

export function ExportWorkspace() {
  const panels = useEditor((state) => state.panels)
  const materials = useEditor((state) => state.materials)
  const legacyLayers = useEditor((state) => state.exportLayers)
  const profiles = useEditor((state) => state.processingProfiles)
  const recipes = useEditor((state) => state.processingRecipes)
  const presets = useEditor((state) => state.laserPresets)
  const lasers = useEditor((state) => state.laserCutters)
  const activeLaserId = useEditor((state) => state.activeLaserId)
  const groups = useEditor((state) => state.groups)
  const laserTexts = useEditor((state) => state.laserTexts)
  const selectedGroupId = useEditor((state) => state.selectedGroupId)
  const moveProfile = useEditor((state) => state.moveProcessingProfile)
  const [exporting, setExporting] = useState(false)
  const [analysis, setAnalysis] = useState<ExportAnalysis | null>(null)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [previewMaterialId, setPreviewMaterialId] = useState<string | null>(
    null,
  )
  const [previewSvg, setPreviewSvg] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const previewStageRef = useRef<HTMLDivElement>(null)
  const previewZoomOutputRef = useRef<HTMLOutputElement>(null)
  const previewBaseViewBoxRef = useRef({ x: 0, y: 0, width: 1, height: 1 })
  const previewViewRef = useRef({ zoom: 1, x: 0, y: 0 })
  const previewDragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
    inverseScreenMatrix: DOMMatrix
  } | null>(null)
  const workerRef = useRef(getExportWorkerClient())
  const [exportGroupId, setExportGroupId] = useState(() =>
    selectedGroupId && groups.some((group) => group.id === selectedGroupId)
      ? selectedGroupId
      : 'all',
  )
  const exportGroup = groups.find((group) => group.id === exportGroupId)
  const visiblePanels = useMemo(
    () =>
      panels.filter(
        (panel) =>
          panel.visible !== false &&
          !groups.some(
            (group) =>
              group.visible === false && group.panelIds.includes(panel.id),
          ),
      ),
    [panels, groups],
  )
  const scopedPanels = useMemo(
    () =>
      exportGroup
        ? visiblePanels.filter((panel) =>
            exportGroup.panelIds.includes(panel.id),
          )
        : visiblePanels,
    [exportGroup, visiblePanels],
  )
  const usedMaterials = useMemo(
    () =>
      materials.filter((material) =>
        scopedPanels.some(
          (panel) => !panel.hidden && panel.materialId === material.id,
        ),
      ),
    [materials, scopedPanels],
  )
  const activeLaser =
    lasers.find((laser) => laser.id === activeLaserId) ?? lasers[0]
  const workerPayload = useMemo<ExportWorkerPayload | null>(
    () =>
      activeLaser
        ? {
            materials: usedMaterials,
            panels: scopedPanels,
            profiles,
            recipes,
            presets,
            laser: activeLaser,
            groups,
          }
        : null,
    [
      usedMaterials,
      scopedPanels,
      profiles,
      recipes,
      presets,
      activeLaser,
      groups,
    ],
  )
  useEffect(() => {
    const worker = workerRef.current
    if (!worker || !workerPayload) {
      setAnalysis({ jobs: [], cache: { hits: 0, misses: 0 } })
      return
    }
    let current = true
    setAnalysis(null)
    setAnalysisError(null)
    void worker
      .analyze(workerPayload)
      .then((result) => {
        if (current) setAnalysis(result)
      })
      .catch((error) => {
        if (current)
          setAnalysisError(
            error instanceof Error ? error.message : String(error),
          )
      })
    return () => {
      current = false
    }
  }, [workerPayload])
  const jobs = analysis?.jobs ?? []
  const previewMaterial = usedMaterials.find(
    (material) => material.id === previewMaterialId,
  )
  useEffect(() => {
    const worker = workerRef.current
    if (!worker || !workerPayload || !previewMaterialId) {
      setPreviewSvg(null)
      return
    }
    let current = true
    setPreviewSvg(null)
    setPreviewError(null)
    void worker
      .preview(workerPayload, previewMaterialId)
      .then((svg) => {
        if (current) setPreviewSvg(svg.replace(/^<\?xml[^>]*>/, ''))
      })
      .catch((error) => {
        if (current)
          setPreviewError(
            error instanceof Error ? error.message : String(error),
          )
      })
    return () => {
      current = false
    }
  }, [workerPayload, previewMaterialId])
  useLayoutEffect(() => {
    const svg = previewStageRef.current?.querySelector('svg')
    if (!svg || !previewSvg) return
    const viewBox = svg.viewBox.baseVal
    const base = {
      x: viewBox.x,
      y: viewBox.y,
      width: viewBox.width || 1,
      height: viewBox.height || 1,
    }
    previewBaseViewBoxRef.current = base
    applyPreviewView({ zoom: 1, x: base.x, y: base.y })
  }, [previewMaterialId, previewSvg])
  const applyPreviewView = (view: { zoom: number; x: number; y: number }) => {
    previewViewRef.current = view
    const svg = previewStageRef.current?.querySelector('svg')
    const base = previewBaseViewBoxRef.current
    svg?.setAttribute(
      'viewBox',
      `${view.x} ${view.y} ${base.width / view.zoom} ${base.height / view.zoom}`,
    )
    if (previewZoomOutputRef.current)
      previewZoomOutputRef.current.value = `${Math.round(view.zoom * 100)}%`
  }
  const zoomPreview = (
    nextZoom: number,
    clientX?: number,
    clientY?: number,
  ) => {
    const svg = previewStageRef.current?.querySelector('svg')
    const base = previewBaseViewBoxRef.current
    const current = previewViewRef.current
    const zoom = Math.min(12, Math.max(0.5, nextZoom))
    if (!svg) return applyPreviewView({ ...current, zoom })
    const rect = svg.getBoundingClientRect()
    const matrix = svg.getScreenCTM()
    if (!matrix) return applyPreviewView({ ...current, zoom })
    const point = new DOMPoint(
      clientX ?? rect.left + rect.width / 2,
      clientY ?? rect.top + rect.height / 2,
    ).matrixTransform(matrix.inverse())
    const currentWidth = base.width / current.zoom
    const currentHeight = base.height / current.zoom
    const fractionX = (point.x - current.x) / currentWidth
    const fractionY = (point.y - current.y) / currentHeight
    applyPreviewView({
      zoom,
      x: point.x - fractionX * (base.width / zoom),
      y: point.y - fractionY * (base.height / zoom),
    })
  }
  const resetPreviewView = () => {
    const base = previewBaseViewBoxRef.current
    applyPreviewView({ zoom: 1, x: base.x, y: base.y })
  }
  const download = async () => {
    if (!workerPayload || !workerRef.current) return
    setExporting(true)
    try {
      const buffer = await workerRef.current.package(
        workerPayload,
        legacyLayers,
        laserTexts.filter((text) =>
          scopedPanels.some((panel) => panel.id === text.panelId),
        ),
      )
      const blob = new Blob([buffer], { type: 'application/zip' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `lasercut-export-${new Date().toISOString().slice(0, 10)}.zip`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : String(error))
    } finally {
      setExporting(false)
    }
  }
  const totalSteps = jobs.reduce((sum, job) => sum + job.steps.length, 0)
  const missingRecipes = jobs.flatMap((job) =>
    job.steps
      .filter((step) => !step.configured)
      .map((step) => ({ material: job.material, step })),
  )
  return (
    <div className="export-workspace profiled-export">
      <header className="export-heading">
        <div>
          <h2>Fertigung</h2>
          <p>
            Prüfe Bearbeitungsreihenfolge, Maschinenwerte und Vorschau, bevor du
            das SVG-/DXF-/LBRN2-Paket für LightBurn herunterlädst.
          </p>
        </div>
        <div>
          <button
            onClick={() => setPreviewMaterialId(usedMaterials[0]?.id ?? null)}
            disabled={!analysis || !usedMaterials.length}
          >
            <Eye /> Vorschau prüfen
          </button>
          <button
            className="download-package"
            disabled={
              !analysis ||
              exporting ||
              !usedMaterials.length ||
              !totalSteps ||
              missingRecipes.length > 0
            }
            title={
              missingRecipes.length
                ? `${missingRecipes.length} Laserzuordnung(en) müssen nachgepflegt werden`
                : undefined
            }
            onClick={download}
          >
            <Download />
            {exporting
              ? 'Exportpaket wird erstellt…'
              : analysis
                ? missingRecipes.length
                  ? 'Laserzuordnungen nachpflegen'
                  : 'Exportpaket herunterladen'
                : 'Bearbeitung wird analysiert…'}
          </button>
        </div>
      </header>
      <div className="export-scope">
        <label>
          <span>Exportumfang</span>
          <select
            value={exportGroupId}
            onChange={(event) => setExportGroupId(event.target.value)}
          >
            <option value="all">Gesamtes Projekt</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </label>
        <small>
          {scopedPanels.filter((panel) => !panel.hidden).length} sichtbare Teile
          · {usedMaterials.length} verwendete
          {usedMaterials.length === 1 ? 's' : ''} Material
          {usedMaterials.length === 1 ? '' : 'ien'}
        </small>
      </div>
      {!analysis && !analysisError && (
        <div className="manufacturing-loading" role="status" aria-live="polite">
          <span className="loading-spinner" />
          <div>
            <strong>Bearbeitungsschritte werden vorbereitet</strong>
            <small>
              Konturen und Aussparungen werden im Hintergrund ausgewertet. Du
              kannst den Arbeitsbereich bereits verwenden.
            </small>
          </div>
        </div>
      )}
      {analysisError && (
        <div className="export-error" role="alert">
          <strong>Fertigungsdaten konnten nicht berechnet werden</strong>
          <span>{analysisError}</span>
          <button
            onClick={() => {
              setAnalysisError(null)
              setAnalysis(null)
              if (workerPayload)
                void workerRef.current
                  ?.analyze(workerPayload)
                  .then(setAnalysis)
                  .catch((error) =>
                    setAnalysisError(
                      error instanceof Error ? error.message : String(error),
                    ),
                  )
            }}
          >
            Erneut versuchen
          </button>
        </div>
      )}
      {analysis && missingRecipes.length > 0 && (
        <div className="recipe-warning" role="alert">
          <strong>
            {missingRecipes.length} Laserzuordnung
            {missingRecipes.length === 1 ? '' : 'en'} nachzupflegen
          </strong>
          <span>
            Die Bearbeitungen bleiben vollständig erhalten. Hinterlege rechts
            beim ausgewählten Laser die Layerwerte für die markierten Profile;
            danach wird der Export freigegeben.
          </span>
        </div>
      )}
      {!usedMaterials.length && (
        <div className="export-empty">
          <strong>Nichts zu exportieren</strong>
          <span>
            Im gewählten Umfang befinden sich keine sichtbaren, materialisierten
            Objekte.
          </span>
        </div>
      )}
      {jobs.map(({ material, steps, sheetCount }) => {
        const materialPanels = scopedPanels.filter(
          (panel) => !panel.hidden && panel.materialId === material.id,
        )
        const profileStepIds = steps
          .filter((step) => step.kind === 'profile')
          .map((step) => step.profileId!)
        return (
          <section
            className="material-job"
            key={material.id}
            style={{ '--material-color': material.color } as CSSProperties}
          >
            <header>
              <i />
              <div>
                <h3>
                  {material.name} · {material.thickness} mm
                </h3>
                <p>
                  {materialPanels.length} Bauteil
                  {materialPanels.length === 1 ? '' : 'e'} · {sheetCount ?? 1}{' '}
                  {(sheetCount ?? 1) === 1 ? 'Blatt' : 'Blätter'} ·{' '}
                  {steps.length} tatsächliche Bearbeitungsschritte
                </p>
              </div>
            </header>
            {!steps.length && (
              <div className="export-empty compact">
                <strong>Keine Ausgabe</strong>
                <span>
                  Alle Objekte dieses Materials sind vom Schnitt ausgeschlossen
                  und besitzen keine Bearbeitungsprofile.
                </span>
              </div>
            )}
            <div className="job-step-list">
              {steps.map((step, index) => (
                <article className={`job-step ${step.kind}`} key={step.id}>
                  <div className="job-order">
                    <strong>{index + 1}</strong>
                    {step.kind === 'profile' && (
                      <span>
                        <button
                          disabled={profileStepIds[0] === step.profileId}
                          onClick={() => moveProfile(step.profileId!, -1)}
                        >
                          <ArrowUp />
                        </button>
                        <button
                          disabled={profileStepIds.at(-1) === step.profileId}
                          onClick={() => moveProfile(step.profileId!, 1)}
                        >
                          <ArrowDown />
                        </button>
                      </span>
                    )}
                  </div>
                  <i
                    className="job-color"
                    style={{ background: step.color }}
                    title="Automatisch zugeordnete LightBurn-Farbe"
                  />
                  <div className="job-identity">
                    <strong>{step.name}</strong>
                    <span>
                      {step.kind === 'profile'
                        ? `${step.mode === 'fill' ? 'Fläche' : 'Kontur'} · zugewiesenes Profil${step.referenceDepth !== undefined ? ` · Referenz ca. ${step.referenceDepth} mm` : ''}`
                        : step.kind === 'cut-inner'
                          ? 'Innenkonturen vor Außenkonturen'
                          : 'Letzter Schnittschritt'}
                    </span>
                    <details>
                      <summary>
                        {step.contourCount} Kontur
                        {step.contourCount === 1 ? '' : 'en'} aus{' '}
                        {step.objectIds.length} Objekt
                        {step.objectIds.length === 1 ? '' : 'en'}
                      </summary>
                      <ul>
                        {step.objectIds.map((id) => (
                          <li key={id}>
                            {panels.find((panel) => panel.id === id)?.label ??
                              id}
                          </li>
                        ))}
                      </ul>
                    </details>
                  </div>
                  {step.configured ? (
                    <div className="job-values">
                      <span>
                        <small>Geschwindigkeit</small>
                        <strong>
                          {step.speed} {activeLaser?.speedUnit}
                        </strong>
                      </span>
                      <span>
                        <small>Leistung</small>
                        <strong>{step.power} %</strong>
                      </span>
                      <span>
                        <small>Durchgänge</small>
                        <strong>{step.passes}×</strong>
                      </span>
                      <span>
                        <small>Air Assist</small>
                        <strong>{step.airAssist ? 'An' : 'Aus'}</strong>
                      </span>
                    </div>
                  ) : (
                    <div className="job-values missing-recipe">
                      <strong>Nachzupflegen</strong>
                      <span>
                        Für {activeLaser?.name} und {material.name} ·{' '}
                        {material.thickness} mm fehlen die Layerwerte.
                      </span>
                    </div>
                  )}
                </article>
              ))}
            </div>
          </section>
        )
      })}
      <div className="export-warning">
        <strong>Vor dem Lasern prüfen</strong>
        <span>
          Referenztiefen sind Kalibrierwerte. Vorschau, Fokus und Maschinenwerte
          am realen Material kontrollieren.
        </span>
      </div>
      {previewMaterial && (
        <div
          className="export-preview-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPreviewMaterialId(null)
          }}
        >
          <section className="export-preview-dialog">
            <header>
              <div>
                <h3>Exportvorschau</h3>
                <p>
                  {previewMaterial.name} · {previewMaterial.thickness} mm ·
                  Farben entsprechen den erzeugten LightBurn-Layern
                </p>
              </div>
              <button onClick={() => setPreviewMaterialId(null)}>
                <X />
              </button>
            </header>
            <nav>
              {usedMaterials.map((material) => (
                <button
                  className={material.id === previewMaterial.id ? 'active' : ''}
                  key={material.id}
                  onClick={() => setPreviewMaterialId(material.id)}
                >
                  <i style={{ background: material.color }} />
                  {material.name} · {material.thickness} mm
                </button>
              ))}
            </nav>
            <div
              className="preview-canvas"
              onWheel={(event) => {
                event.preventDefault()
                zoomPreview(
                  previewViewRef.current.zoom *
                    Math.exp(-event.deltaY * 0.0015),
                  event.clientX,
                  event.clientY,
                )
              }}
              onPointerDown={(event) => {
                if (event.button !== 0) return
                const matrix = previewStageRef.current
                  ?.querySelector('svg')
                  ?.getScreenCTM()
                if (!matrix) return
                const inverseScreenMatrix = matrix.inverse()
                const start = new DOMPoint(
                  event.clientX,
                  event.clientY,
                ).matrixTransform(inverseScreenMatrix)
                event.currentTarget.setPointerCapture(event.pointerId)
                previewDragRef.current = {
                  pointerId: event.pointerId,
                  startX: start.x,
                  startY: start.y,
                  originX: previewViewRef.current.x,
                  originY: previewViewRef.current.y,
                  inverseScreenMatrix,
                }
                event.currentTarget.classList.add('panning')
              }}
              onPointerMove={(event) => {
                const drag = previewDragRef.current
                if (!drag || drag.pointerId !== event.pointerId) return
                const point = new DOMPoint(
                  event.clientX,
                  event.clientY,
                ).matrixTransform(drag.inverseScreenMatrix)
                applyPreviewView({
                  zoom: previewViewRef.current.zoom,
                  x: drag.originX - (point.x - drag.startX),
                  y: drag.originY - (point.y - drag.startY),
                })
              }}
              onPointerUp={(event) => {
                if (previewDragRef.current?.pointerId !== event.pointerId)
                  return
                previewDragRef.current = null
                event.currentTarget.classList.remove('panning')
                event.currentTarget.releasePointerCapture(event.pointerId)
              }}
              onPointerCancel={(event) => {
                previewDragRef.current = null
                event.currentTarget.classList.remove('panning')
              }}
            >
              {previewSvg ? (
                <div
                  ref={previewStageRef}
                  className="preview-stage"
                  dangerouslySetInnerHTML={{ __html: previewSvg }}
                />
              ) : previewError ? (
                <div className="preview-status error">
                  <strong>Vorschau nicht verfügbar</strong>
                  <span>{previewError}</span>
                </div>
              ) : (
                <div className="preview-status">
                  <span className="loading-spinner" />
                  <strong>Vorschau wird erzeugt…</strong>
                </div>
              )}
              {previewSvg && (
                <div
                  className="preview-controls"
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <button
                    title="Verkleinern"
                    aria-label="Vorschau verkleinern"
                    onClick={() =>
                      zoomPreview(previewViewRef.current.zoom / 1.35)
                    }
                  >
                    <Minus />
                  </button>
                  <output ref={previewZoomOutputRef}>100%</output>
                  <button
                    title="Vergrößern"
                    aria-label="Vorschau vergrößern"
                    onClick={() =>
                      zoomPreview(previewViewRef.current.zoom * 1.35)
                    }
                  >
                    <Plus />
                  </button>
                  <button
                    title="Alles einpassen"
                    aria-label="Vorschau einpassen"
                    onClick={resetPreviewView}
                  >
                    <Maximize2 />
                  </button>
                </div>
              )}
            </div>
            <div className="preview-legend">
              {jobs
                .find((job) => job.material.id === previewMaterial.id)
                ?.steps.map((step) => (
                  <span key={step.id}>
                    <i style={{ background: step.color }} />
                    {step.name}
                  </span>
                ))}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
