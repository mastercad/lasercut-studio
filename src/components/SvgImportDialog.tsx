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
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import { parseSvgImport, type SvgImportDocument } from '../model/svgImport'
import { useEditor } from '../store/editor'

type Props = {
  open: boolean
  initialFile?: File | null
  onInitialFileRead?: () => void
  onClose: () => void
}
const distance = (a: string, b: string) => {
  const rgb = (color: string) => {
    const value = color.replace('#', '')
    return value.length === 6
      ? [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16))
      : [128, 128, 128]
  }
  const first = rgb(a),
    second = rgb(b)
  return first.reduce(
    (sum, value, index) => sum + (value - second[index]) ** 2,
    0,
  )
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
  const [dragging, setDragging] = useState(false)

  const reset = () => {
    setDocument(null)
    setStep(1)
    setError('')
    setSelected(new Set())
    setIncluded(new Set())
    setAssignments({})
  }
  const close = () => {
    reset()
    onClose()
  }
  const readFile = async (file?: File) => {
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.svg')) {
      setError('Bitte eine Datei mit der Endung .svg auswählen.')
      return
    }
    try {
      const parsed = parseSvgImport(await file.text(), file.name)
      const suggested = Object.fromEntries(
        parsed.objects.map((object) => [
          object.id,
          object.color && materials.length
            ? [...materials].sort(
                (a, b) =>
                  distance(object.color!, a.color) -
                  distance(object.color!, b.color),
              )[0].id
            : (materials[0]?.id ?? ''),
        ]),
      )
      setDocument(parsed)
      setWidth(Number(parsed.widthMm.toFixed(2)))
      setHeight(Number(parsed.heightMm.toFixed(2)))
      setIncluded(new Set(parsed.objects.map((object) => object.id)))
      setSelected(new Set(parsed.objects.map((object) => object.id)))
      setAssignments(suggested)
      setError('')
      setStep(2)
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Die SVG-Datei konnte nicht gelesen werden.',
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
      document?.objects.map((object) => ({
        ...object,
        path: object.faces
          .map((face) => {
            const ring = (points: [number, number][]) =>
              `M ${points.map(([x, y]) => `${x},${-y}`).join(' L ')} Z`
            return `${ring(face.outer)} ${face.holes.map(ring).join(' ')}`
          })
          .join(' '),
      })) ?? [],
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
  const finish = () => {
    if (!document) return
    const objects = document.objects
      .filter((object) => included.has(object.id))
      .map((object) => ({
        name: object.name,
        groupName: object.groupName,
        materialId: assignments[object.id],
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
    importSvgObjects(document.fileName.replace(/\.svg$/i, ''), objects)
    close()
  }
  const selectedCount = selected.size
  const chosenCount =
    document?.objects.filter((object) => included.has(object.id)).length ?? 0
  const allAssigned =
    document?.objects
      .filter((object) => included.has(object.id))
      .every((object) => assignments[object.id]) ?? false
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
            <h2 id="svg-import-title">SVG-Vorlage importieren</h2>
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
              onClick={() => inputRef.current?.click()}
            >
              <Upload />
              <h3>SVG hier ablegen</h3>
              <p>oder klicken, um eine Datei auszuwählen</p>
              <button>SVG auswählen</button>
              <input
                ref={inputRef}
                type="file"
                accept=".svg,image/svg+xml"
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
                      <path
                        key={object.id}
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
                        className={`${selected.has(object.id) ? 'selected' : ''}${included.has(object.id) ? '' : ' excluded'}`}
                        onClick={() => {
                          if (suppressPreviewClick.current) {
                            suppressPreviewClick.current = false
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
                      · Klick auf ein Material weist es zu.
                    </p>
                    <div className="svg-material-cards">
                      {materials.map((material) => (
                        <button
                          key={material.id}
                          onClick={() => assign(material.id)}
                        >
                          <i style={{ background: material.color }} />
                          <span>
                            <strong>{material.name}</strong>
                            <small>
                              {material.thickness} mm · Schnittfuge{' '}
                              {material.kerf} mm
                            </small>
                          </span>
                        </button>
                      ))}
                    </div>
                    <button
                      className="svg-select-all"
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
                    <div className="svg-object-list">
                      {document.objects.map((object) => (
                        <label key={object.id}>
                          <input
                            type="checkbox"
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
                            {object.name}
                            <small>
                              {object.groupName}
                              {object.color
                                ? ' · Farbe automatisch erkannt'
                                : ''}
                            </small>
                          </span>
                          <strong>
                            {materials.find(
                              (material) =>
                                material.id === assignments[object.id],
                            )?.thickness ?? '–'}{' '}
                            mm
                          </strong>
                        </label>
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
                (step === 3 && (!chosenCount || !allAssigned))
              }
              onClick={() => setStep(step + 1)}
            >
              Weiter
            </button>
          )}
          {step === 4 && (
            <button
              className="primary"
              disabled={!chosenCount || !allAssigned}
              onClick={finish}
            >
              <FileUp /> In 3D übernehmen
            </button>
          )}
        </footer>
      </section>
    </div>
  )
}
