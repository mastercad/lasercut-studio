import {
  AlertTriangle,
  Check,
  FileUp,
  Link,
  Link2Off,
  Maximize2,
  Minus,
  MousePointer2,
  Plus,
  Upload,
  X,
} from 'lucide-react'
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import {
  parseDxfImport,
  parseLbrnImport,
  parseLbrn2Import,
  parseSvgImport,
  type SvgImportDocument,
} from '../model/svgImport'
import { useEditor } from '../store/editor'

type Props = {
  open: boolean
  initialFile?: File | null
  onInitialFileRead?: () => void
  onClose: () => void
}
export function SvgImportDialog({
  open,
  initialFile,
  onInitialFileRead,
  onClose,
}: Props) {
  const materials = useEditor((state) => state.materials)
  const importSvgObjects = useEditor((state) => state.importSvgObjects)
  const inputRef = useRef<HTMLInputElement>(null)
  const previewSvgRef = useRef<SVGSVGElement>(null)
  const previewZoomOutputRef = useRef<HTMLOutputElement>(null)
  const previewView = useRef({ zoom: 1, x: 0, y: 0 })
  const previewDrag = useRef<{
    pointerId: number
    x: number
    y: number
  } | null>(null)
  const suppressPreviewClick = useRef(false)
  const [document, setDocument] = useState<SvgImportDocument | null>(null)
  const [step, setStep] = useState(1)
  const [error, setError] = useState('')
  const [width, setWidth] = useState(100)
  const [height, setHeight] = useState(100)
  const [linked, setLinked] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [included, setIncluded] = useState<Set<string>>(new Set())
  const [assignments, setAssignments] = useState<Record<string, string>>({})
  const [materialWizard, setMaterialWizard] = useState(false)
  const [wizardIndex, setWizardIndex] = useState(0)
  const [wizardReviewed, setWizardReviewed] = useState<Set<string>>(new Set())
  const [dragging, setDragging] = useState(false)

  const reset = () => {
    setDocument(null)
    setStep(1)
    setError('')
    setSelected(new Set())
    setIncluded(new Set())
    setAssignments({})
    setMaterialWizard(false)
    setWizardIndex(0)
    setWizardReviewed(new Set())
  }
  const close = () => {
    reset()
    onClose()
  }
  const readFile = async (file?: File) => {
    if (!file) return
    const lowerName = file.name.toLowerCase()
    const extension = lowerName.match(/\.(svg|dxf|lbrn|lbrn2)$/)?.[1]
    if (!extension) {
      setError(
        'Bitte eine Datei mit der Endung .svg, .dxf, .lbrn oder .lbrn2 auswählen.',
      )
      return
    }
    try {
      const contents = await file.text()
      const parsed =
        extension === 'dxf'
          ? parseDxfImport(contents, file.name)
          : extension === 'lbrn'
            ? parseLbrnImport(contents, file.name)
            : extension === 'lbrn2'
              ? parseLbrn2Import(contents, file.name)
              : parseSvgImport(contents, file.name)
      setDocument(parsed)
      setWidth(Number(parsed.widthMm.toFixed(2)))
      setHeight(Number(parsed.heightMm.toFixed(2)))
      const recommended = parsed.objects
        .filter((object) => object.recommendedInclude !== false)
        .map((object) => object.id)
      setIncluded(new Set(recommended))
      setSelected(new Set(recommended))
      setAssignments({})
      setMaterialWizard(false)
      setWizardIndex(0)
      setWizardReviewed(new Set())
      setError('')
      setStep(2)
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Die Vektordatei konnte nicht gelesen werden.',
      )
    }
  }
  useEffect(() => {
    if (!open || !initialFile) return
    void readFile(initialFile)
    onInitialFileRead?.()
  }, [open, initialFile])
  const scaleX = document ? width / document.sourceWidth : 1
  const scaleY = document ? height / document.sourceHeight : 1
  const preview = useMemo(
    () =>
      document?.objects
        .map((object) => ({
          ...object,
          path: object.faces
            .map((face) => {
              const ring = (points: [number, number][]) =>
                `M ${points.map(([x, y]) => `${x},${-y}`).join(' L ')} Z`
              return `${ring(face.outer)} ${face.holes.map(ring).join(' ')}`
            })
            .join(' '),
        }))
        .sort(
          (first, second) =>
            (second.bounds.maxX - second.bounds.minX) *
              (second.bounds.maxY - second.bounds.minY) -
            (first.bounds.maxX - first.bounds.minX) *
              (first.bounds.maxY - first.bounds.minY),
        ) ?? [],
    [document],
  )
  const previewBaseViewBox = useMemo(
    () =>
      document?.objects.length
        ? ([
            Math.min(...document.objects.map((object) => object.bounds.minX)),
            -Math.max(...document.objects.map((object) => object.bounds.maxY)),
            document.sourceWidth,
            document.sourceHeight,
          ] as [number, number, number, number])
        : ([0, 0, 100, 100] as [number, number, number, number]),
    [document],
  )
  const selectedPreviewIds = useMemo(() => {
    const ids = new Set(selected)
    for (const object of document?.objects ?? [])
      if (selected.has(object.id))
        for (const operation of object.attachedOperations ?? [])
          ids.add(operation.id)
    return ids
  }, [document, selected])
  const applyPreviewView = (view: { zoom: number; x: number; y: number }) => {
    previewView.current = view
    previewSvgRef.current?.setAttribute(
      'viewBox',
      `${view.x} ${view.y} ${previewBaseViewBox[2] / view.zoom} ${previewBaseViewBox[3] / view.zoom}`,
    )
    if (previewZoomOutputRef.current)
      previewZoomOutputRef.current.value = `${Math.round(view.zoom * 100)}%`
  }
  const resetPreviewView = () =>
    applyPreviewView({
      zoom: 1,
      x: previewBaseViewBox[0],
      y: previewBaseViewBox[1],
    })
  useEffect(() => {
    if (document) resetPreviewView()
  }, [document, previewBaseViewBox])
  const focusObject = (objectId: string) => {
    const object = document?.objects.find(
      (candidate) => candidate.id === objectId,
    )
    if (!object) return
    const width = Math.max(0.1, object.bounds.maxX - object.bounds.minX)
    const height = Math.max(0.1, object.bounds.maxY - object.bounds.minY)
    const zoom = Math.min(
      16,
      Math.max(
        1,
        Math.min(
          previewBaseViewBox[2] / (width * 1.5),
          previewBaseViewBox[3] / (height * 1.5),
        ),
      ),
    )
    const viewWidth = previewBaseViewBox[2] / zoom
    const viewHeight = previewBaseViewBox[3] / zoom
    applyPreviewView({
      zoom,
      x: (object.bounds.minX + object.bounds.maxX - viewWidth) / 2,
      y: (-object.bounds.maxY - object.bounds.minY - viewHeight) / 2,
    })
  }
  const zoomPreview = (
    nextZoom: number,
    clientX?: number,
    clientY?: number,
  ) => {
    const svg = previewSvgRef.current
    const current = previewView.current
    const zoom = Math.min(20, Math.max(1, nextZoom))
    const matrix = svg?.getScreenCTM()
    const rect = svg?.getBoundingClientRect()
    if (!svg || !matrix || !rect) return applyPreviewView({ ...current, zoom })
    const point = new DOMPoint(
      clientX ?? rect.left + rect.width / 2,
      clientY ?? rect.top + rect.height / 2,
    ).matrixTransform(matrix.inverse())
    const currentWidth = previewBaseViewBox[2] / current.zoom,
      currentHeight = previewBaseViewBox[3] / current.zoom
    const nextWidth = previewBaseViewBox[2] / zoom,
      nextHeight = previewBaseViewBox[3] / zoom
    const ratioX = (point.x - current.x) / currentWidth,
      ratioY = (point.y - current.y) / currentHeight
    applyPreviewView({
      zoom,
      x: point.x - ratioX * nextWidth,
      y: point.y - ratioY * nextHeight,
    })
  }
  const handlePreviewWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    zoomPreview(
      previewView.current.zoom * Math.exp(-event.deltaY * 0.0015),
      event.clientX,
      event.clientY,
    )
  }
  const beginPreviewPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1) return
    previewDrag.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    }
    suppressPreviewClick.current = false
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const movePreviewPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = previewDrag.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const dx = event.clientX - drag.x,
      dy = event.clientY - drag.y
    if (Math.abs(dx) + Math.abs(dy) < 1) return
    previewDrag.current = { ...drag, x: event.clientX, y: event.clientY }
    suppressPreviewClick.current = true
    const matrix = previewSvgRef.current?.getScreenCTM()
    if (!matrix) return
    const current = previewView.current
    applyPreviewView({
      ...current,
      x: current.x - dx / matrix.a,
      y: current.y - dy / matrix.d,
    })
  }
  const endPreviewPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (previewDrag.current?.pointerId === event.pointerId)
      previewDrag.current = null
  }
  if (!open) return null
  const setWidthValue = (value: number) => {
    const next = Math.max(0.1, value)
    setWidth(next)
    if (linked && document)
      setHeight((next * document.sourceHeight) / document.sourceWidth)
  }
  const setHeightValue = (value: number) => {
    const next = Math.max(0.1, value)
    setHeight(next)
    if (linked && document)
      setWidth((next * document.sourceWidth) / document.sourceHeight)
  }
  const assign = (materialId: string) => {
    const ids = selected.size ? selected : included
    setAssignments((current) => ({
      ...current,
      ...Object.fromEntries([...ids].map((id) => [id, materialId])),
    }))
  }
  const assignAll = (materialId: string) =>
    setAssignments((current) => ({
      ...current,
      ...Object.fromEntries([...included].map((id) => [id, materialId])),
    }))
  const wizardObjects =
    document?.objects.filter((object) => object.recommendedInclude !== false) ??
    []
  const wizardObject = wizardObjects[wizardIndex]
  const startMaterialWizard = () => {
    const candidateIds = new Set(wizardObjects.map((object) => object.id))
    setMaterialWizard(true)
    setWizardIndex(0)
    setWizardReviewed(new Set())
    setIncluded(new Set([...included].filter((id) => !candidateIds.has(id))))
    setAssignments((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([id]) => !candidateIds.has(id)),
      ),
    )
    if (wizardObjects[0]) {
      setSelected(new Set([wizardObjects[0].id]))
      focusObject(wizardObjects[0].id)
    }
  }
  const showWizardObject = (index: number) => {
    const next = Math.max(0, Math.min(wizardObjects.length - 1, index))
    setWizardIndex(next)
    const object = wizardObjects[next]
    if (object) {
      setSelected(new Set([object.id]))
      focusObject(object.id)
    }
  }
  const decideWizardObject = (materialId: string | null) => {
    if (!wizardObject) return
    setWizardReviewed((current) => new Set(current).add(wizardObject.id))
    setIncluded((current) => {
      const next = new Set(current)
      if (materialId) next.add(wizardObject.id)
      else next.delete(wizardObject.id)
      return next
    })
    setAssignments((current) => {
      const next = { ...current }
      if (materialId) next[wizardObject.id] = materialId
      else delete next[wizardObject.id]
      return next
    })
    if (wizardIndex < wizardObjects.length - 1)
      setTimeout(() => showWizardObject(wizardIndex + 1), 0)
  }
  const commonAssignment = (ids: Set<string>) => {
    const values = [...ids].map((id) => assignments[id]).filter(Boolean)
    return values.length === ids.size && new Set(values).size === 1
      ? values[0]
      : ''
  }
  const finish = () => {
    if (!document) return
    const objects = document.objects
      .filter((object) => included.has(object.id))
      .map((object) => ({
        name: object.name,
        groupName: object.groupName,
        materialId: assignments[object.id],
        attachedOperations: object.attachedOperations?.map((operation) => ({
          ...operation,
          faces: operation.faces.map((face) => ({
            ...face,
            outer: face.outer.map(
              ([x, y]) => [x * scaleX, y * scaleY] as [number, number],
            ),
            holes: face.holes.map((hole) =>
              hole.map(
                ([x, y]) => [x * scaleX, y * scaleY] as [number, number],
              ),
            ),
          })),
        })),
        faces: object.faces.map((face) => ({
          ...face,
          outer: face.outer.map(
            ([x, y]) => [x * scaleX, y * scaleY] as [number, number],
          ),
          holes: face.holes.map((hole) =>
            hole.map(([x, y]) => [x * scaleX, y * scaleY] as [number, number]),
          ),
        })),
      }))
    importSvgObjects(
      document.fileName.replace(/\.(?:svg|dxf|lbrn|lbrn2)$/i, ''),
      objects,
    )
    close()
  }
  const downloadConvertedSvg = () => {
    if (!document?.convertedSvg) return
    const blob = new Blob([document.convertedSvg], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const link = globalThis.document.createElement('a')
    link.href = url
    link.download = document.fileName.replace(/\.(?:dxf|lbrn|lbrn2)$/i, '.svg')
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const selectedCount = selected.size
  const chosenCount =
    document?.objects.filter((object) => included.has(object.id)).length ?? 0
  const allAssigned =
    document?.objects
      .filter((object) => included.has(object.id))
      .every((object) => assignments[object.id]) ?? false
  const wizardComplete =
    !materialWizard || wizardReviewed.size === wizardObjects.length
  return (
    <div
      className="svg-import-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <section
        className="svg-import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="svg-import-title"
      >
        <header>
          <div>
            <h2 id="svg-import-title">
              {document?.sourceFormat === 'lbrn' ||
              document?.sourceFormat === 'lbrn2'
                ? 'LightBurn-Projekt importieren'
                : document?.sourceFormat === 'dxf'
                  ? 'DXF-Datei importieren'
                  : 'Vektordatei importieren'}
            </h2>
          </div>
          <button onClick={close} aria-label="Import schließen">
            <X />
          </button>
        </header>
        <ol className="svg-import-steps">
          {['Datei', 'Größe', 'Material', 'Prüfen'].map((label, index) => (
            <li
              key={label}
              className={
                step === index + 1 ? 'active' : step > index + 1 ? 'done' : ''
              }
            >
              <i>{step > index + 1 ? <Check /> : index + 1}</i>
              <span>{label}</span>
            </li>
          ))}
        </ol>
        <div className="svg-import-body">
          {step === 1 && (
            <div
              className={`svg-drop-zone${dragging ? ' dragging' : ''}`}
              onDragOver={(event) => {
                event.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault()
                setDragging(false)
                void readFile(event.dataTransfer.files[0])
              }}
              onClick={(event) => {
                if (event.target === inputRef.current) return
                inputRef.current?.click()
              }}
            >
              <Upload />
              <h3>Vektordatei hier ablegen</h3>
              <p>oder klicken, um eine Datei auszuwählen</p>
              <button>Datei auswählen</button>
              <input
                ref={inputRef}
                type="file"
                accept=".svg,.dxf,.lbrn,.lbrn2,image/svg+xml,application/dxf,application/xml,text/xml"
                onChange={(event) => {
                  void readFile(event.target.files?.[0])
                  event.target.value = ''
                }}
              />
            </div>
          )}
          {error && (
            <div className="svg-import-error">
              <AlertTriangle />
              {error}
            </div>
          )}
          {document && step >= 2 && (
            <div className="svg-import-workspace">
              <div className="svg-preview-card">
                <div className="svg-preview-heading">
                  <strong>{document.fileName}</strong>
                  <span>
                    {document.objects.length} geschlossene Form
                    {document.objects.length === 1 ? '' : 'en'}
                  </span>
                </div>
                <div
                  className="svg-preview-canvas"
                  onWheel={handlePreviewWheel}
                  onPointerDown={beginPreviewPan}
                  onPointerMove={movePreviewPan}
                  onPointerUp={endPreviewPan}
                  onPointerCancel={endPreviewPan}
                  onDoubleClick={resetPreviewView}
                >
                  <svg
                    ref={previewSvgRef}
                    viewBox={previewBaseViewBox.join(' ')}
                    preserveAspectRatio="xMidYMid meet"
                  >
                    {preview.map((object) => (
                      <Fragment key={object.id}>
                        {selectedPreviewIds.has(object.id) && (
                          <path
                            className="selection-halo"
                            d={object.path}
                            fill="none"
                            fillRule="evenodd"
                          />
                        )}
                        <path
                          d={object.path}
                          fill={
                            assignments[object.id]
                              ? materials.find(
                                  (material) =>
                                    material.id === assignments[object.id],
                                )?.color
                              : (object.color ?? '#d9a96c')
                          }
                          fillRule="evenodd"
                          className={`${selectedPreviewIds.has(object.id) ? 'selected' : selectedCount ? 'dimmed' : ''}${included.has(object.id) || selectedPreviewIds.has(object.id) ? '' : ' excluded'}`}
                          onClick={() => {
                            if (suppressPreviewClick.current) {
                              suppressPreviewClick.current = false
                              return
                            }
                            if (
                              selected.size === 1 &&
                              selected.has(object.id)
                            ) {
                              setSelected(new Set())
                              resetPreviewView()
                              return
                            }
                            setSelected((current) => {
                              const next = new Set(current)
                              if (next.has(object.id)) next.delete(object.id)
                              else next.add(object.id)
                              return next
                            })
                          }}
                        />
                      </Fragment>
                    ))}
                  </svg>
                  <div
                    className="svg-preview-controls"
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    <button
                      title="Verkleinern"
                      aria-label="Vorschau verkleinern"
                      onClick={() =>
                        zoomPreview(previewView.current.zoom / 1.35)
                      }
                    >
                      <Minus />
                    </button>
                    <output ref={previewZoomOutputRef}>100%</output>
                    <button
                      title="Vergrößern"
                      aria-label="Vorschau vergrößern"
                      onClick={() =>
                        zoomPreview(previewView.current.zoom * 1.35)
                      }
                    >
                      <Plus />
                    </button>
                    <button
                      title="Alles einpassen"
                      aria-label="Gesamte Vorlage einpassen"
                      onClick={resetPreviewView}
                    >
                      <Maximize2 />
                    </button>
                  </div>
                </div>
                {step === 3 && (
                  <small>
                    <MousePointer2 /> Formen in der Vorschau anklicken, um sie
                    auszuwählen.
                  </small>
                )}
              </div>
              <div className="svg-import-options">
                {step === 2 && (
                  <>
                    <h3>Endgröße bestätigen</h3>
                    <p>Diese Maße erhält die gesamte Vorlage im 3D-Modell.</p>
                    <div className="svg-size-fields">
                      <label>
                        <span>Breite</span>
                        <div>
                          <input
                            type="number"
                            min="0.1"
                            step="0.1"
                            value={Number(width.toFixed(2))}
                            onChange={(event) =>
                              setWidthValue(Number(event.target.value))
                            }
                          />
                          <em>mm</em>
                        </div>
                      </label>
                      <button
                        className={linked ? 'active' : ''}
                        title="Seitenverhältnis koppeln"
                        onClick={() => setLinked(!linked)}
                      >
                        {linked ? <Link /> : <Link2Off />}
                      </button>
                      <label>
                        <span>Höhe</span>
                        <div>
                          <input
                            type="number"
                            min="0.1"
                            step="0.1"
                            value={Number(height.toFixed(2))}
                            onChange={(event) =>
                              setHeightValue(Number(event.target.value))
                            }
                          />
                          <em>mm</em>
                        </div>
                      </label>
                    </div>
                    {!document.hasReliableSize && (
                      <div className="svg-size-warning">
                        <AlertTriangle />
                        <span>
                          <strong>Bitte Maße prüfen</strong>Die Datei enthält
                          keine eindeutige Millimetergröße.
                        </span>
                      </div>
                    )}
                  </>
                )}
                {step === 3 && (
                  <>
                    <h3>Material zuweisen</h3>
                    <p>
                      {selectedCount
                        ? `${selectedCount} Form${selectedCount === 1 ? '' : 'en'} ausgewählt`
                        : 'Keine Form ausgewählt'}{' '}
                      · LightBurn-Farben sind Ebenenfarben und keine
                      Materialangaben.
                    </p>
                    {document.estimatedThickness && (
                      <div className="svg-thickness-estimate">
                        <strong>
                          Geschätzte Materialstärke:{' '}
                          {document.estimatedThickness.mm.toFixed(1)} mm
                        </strong>
                        <span>
                          Sicherheit: {document.estimatedThickness.confidence} ·{' '}
                          aus {document.estimatedThickness.evidenceCount}{' '}
                          wiederkehrenden Zinkenmaßen. Bitte vor dem Import
                          bestätigen.
                        </span>
                      </div>
                    )}
                    <button
                      type="button"
                      className={`svg-wizard-toggle${materialWizard ? ' active' : ''}`}
                      onClick={() => {
                        if (materialWizard) {
                          setMaterialWizard(false)
                          setSelected(new Set())
                          resetPreviewView()
                        } else startMaterialWizard()
                      }}
                    >
                      {materialWizard
                        ? 'Materialwizard beenden'
                        : 'Materialwizard verwenden'}
                    </button>
                    {materialWizard && wizardObject && (
                      <div className="svg-material-wizard">
                        <div className="svg-wizard-progress">
                          <strong>
                            Objekt {wizardIndex + 1} von {wizardObjects.length}
                          </strong>
                          <span>
                            {wizardReviewed.size} vollständig kontrolliert
                          </span>
                        </div>
                        <h4>{wizardObject.name}</h4>
                        <p>
                          {wizardObject.groupName} ·{' '}
                          {(
                            (wizardObject.bounds.maxX -
                              wizardObject.bounds.minX) *
                            scaleX
                          ).toFixed(1)}{' '}
                          ×{' '}
                          {(
                            (wizardObject.bounds.maxY -
                              wizardObject.bounds.minY) *
                            scaleY
                          ).toFixed(1)}{' '}
                          mm
                          {wizardObject.attachedOperations?.length
                            ? ` · ${wizardObject.attachedOperations.length} zugeordnete Bearbeitung${wizardObject.attachedOperations.length === 1 ? '' : 'en'}`
                            : ''}
                        </p>
                        <label>
                          <span>Material festlegen und weiter</span>
                          <select
                            aria-label={`Materialwizard: Material für ${wizardObject.name}`}
                            value={assignments[wizardObject.id] ?? ''}
                            onChange={(event) =>
                              decideWizardObject(event.target.value)
                            }
                          >
                            <option value="">Material auswählen …</option>
                            {materials.map((material) => (
                              <option key={material.id} value={material.id}>
                                {material.name} · {material.thickness} mm
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          type="button"
                          className="svg-wizard-disable"
                          onClick={() => decideWizardObject(null)}
                        >
                          Dieses Objekt nicht importieren
                        </button>
                        <div className="svg-wizard-navigation">
                          <button
                            type="button"
                            disabled={wizardIndex === 0}
                            onClick={() => showWizardObject(wizardIndex - 1)}
                          >
                            Vorheriges Objekt
                          </button>
                          <button
                            type="button"
                            disabled={wizardIndex === wizardObjects.length - 1}
                            onClick={() => showWizardObject(wizardIndex + 1)}
                          >
                            Nächstes Objekt
                          </button>
                        </div>
                      </div>
                    )}
                    <div
                      className={`svg-material-assignment${materialWizard ? ' wizard-hidden' : ''}`}
                    >
                      <label>
                        <span>Alle verwendeten Formen</span>
                        <select
                          aria-label="Material für alle verwendeten Formen"
                          value={commonAssignment(included)}
                          onChange={(event) => assignAll(event.target.value)}
                        >
                          <option value="">Material auswählen …</option>
                          {materials.map((material) => (
                            <option key={material.id} value={material.id}>
                              {material.name} · {material.thickness} mm
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Aktuelle Auswahl ({selectedCount})</span>
                        <select
                          aria-label="Material für ausgewählte Formen"
                          disabled={!selectedCount}
                          value={commonAssignment(selected)}
                          onChange={(event) => assign(event.target.value)}
                        >
                          <option value="">Material auswählen …</option>
                          {materials.map((material) => (
                            <option key={material.id} value={material.id}>
                              {material.name} · {material.thickness} mm
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <button
                      className={`svg-select-all${materialWizard ? ' wizard-hidden' : ''}`}
                      onClick={() =>
                        setSelected(
                          new Set(
                            document.objects
                              .filter((object) => included.has(object.id))
                              .map((object) => object.id),
                          ),
                        )
                      }
                    >
                      Alle verwendeten Formen auswählen
                    </button>
                    <div
                      className={`svg-object-list${materialWizard ? ' wizard-hidden' : ''}`}
                    >
                      {document.objects.map((object) => (
                        <div
                          key={object.id}
                          className={selected.has(object.id) ? 'selected' : ''}
                        >
                          <input
                            type="checkbox"
                            aria-label={`${object.name} importieren`}
                            checked={included.has(object.id)}
                            onChange={() =>
                              setIncluded((current) => {
                                const next = new Set(current)
                                if (next.has(object.id)) next.delete(object.id)
                                else next.add(object.id)
                                return next
                              })
                            }
                          />
                          <i
                            style={{
                              background:
                                materials.find(
                                  (material) =>
                                    material.id === assignments[object.id],
                                )?.color ??
                                object.color ??
                                '#888',
                            }}
                          />
                          <span>
                            <button
                              type="button"
                              onClick={() => {
                                if (
                                  selected.size === 1 &&
                                  selected.has(object.id)
                                ) {
                                  setSelected(new Set())
                                  resetPreviewView()
                                  return
                                }
                                setSelected(new Set([object.id]))
                                focusObject(object.id)
                              }}
                            >
                              {object.name}
                            </button>
                            <small>
                              {object.groupName} ·{' '}
                              {(
                                (object.bounds.maxX - object.bounds.minX) *
                                scaleX
                              ).toFixed(1)}{' '}
                              ×{' '}
                              {(
                                (object.bounds.maxY - object.bounds.minY) *
                                scaleY
                              ).toFixed(1)}{' '}
                              mm
                            </small>
                          </span>
                          <select
                            aria-label={`Material für ${object.name}`}
                            value={assignments[object.id] ?? ''}
                            onChange={(event) =>
                              setAssignments((current) => ({
                                ...current,
                                [object.id]: event.target.value,
                              }))
                            }
                          >
                            <option value="">Nicht zugewiesen</option>
                            {materials.map((material) => (
                              <option key={material.id} value={material.id}>
                                {material.name} · {material.thickness} mm
                                {document.estimatedThickness &&
                                Math.abs(
                                  material.thickness -
                                    document.estimatedThickness.mm,
                                ) <= 0.25
                                  ? ' · passend zur Schätzung'
                                  : ''}
                              </option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {step === 4 && (
                  <>
                    <h3>Bereit für die 3D-Ansicht</h3>
                    <div className="svg-summary">
                      <div>
                        <strong>{chosenCount}</strong>
                        <span>Materialteile</span>
                      </div>
                      <div>
                        <strong>
                          {width.toFixed(1)} × {height.toFixed(1)}
                        </strong>
                        <span>Gesamtgröße in mm</span>
                      </div>
                      <div>
                        <strong>
                          {
                            new Set(
                              document.objects
                                .filter((object) => included.has(object.id))
                                .map((object) => object.groupName),
                            ).size
                          }
                        </strong>
                        <span>Baugruppen</span>
                      </div>
                    </div>
                    <p>
                      Alle Teile werden gemeinsam eingefügt und ausgewählt. Der
                      gesamte Import lässt sich mit einmal „Rückgängig“
                      entfernen.
                    </p>
                    {document.warnings.length > 0 && (
                      <div className="svg-warning-list">
                        <strong>Hinweise</strong>
                        {document.warnings.map((warning, index) => (
                          <span key={index}>
                            <AlertTriangle />
                            {warning.message}
                          </span>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
        <footer>
          <button
            className="secondary"
            onClick={
              step === 1
                ? close
                : () => setStep((current) => Math.max(1, current - 1))
            }
          >
            {step === 1 ? 'Abbrechen' : 'Zurück'}
          </button>
          <span>
            {document
              ? `${chosenCount} von ${document.objects.length} Formen werden importiert`
              : 'Noch keine Datei ausgewählt'}
          </span>
          {step > 1 && step < 4 && (
            <button
              className="primary"
              disabled={
                !document?.objects.length ||
                (step === 3 && (!chosenCount || !allAssigned)) ||
                (step === 3 && !wizardComplete)
              }
              onClick={() => setStep(step + 1)}
            >
              Weiter
            </button>
          )}
          {step === 4 && (
            <>
              {document?.convertedSvg && (
                <button className="secondary" onClick={downloadConvertedSvg}>
                  <FileUp /> Als SVG speichern
                </button>
              )}
              <button
                className="primary"
                disabled={!chosenCount || !allAssigned}
                onClick={finish}
              >
                <FileUp /> In 3D übernehmen
              </button>
            </>
          )}
        </footer>
      </section>
    </div>
  )
}
