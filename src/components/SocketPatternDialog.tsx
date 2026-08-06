import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Pipette, Trash2, X } from 'lucide-react'
import { useEditor } from '../store/editor'
import { thinAxis } from '../model/box'
import {
  buildSocketPattern,
  buildTransferredSocketPattern,
  socketPatternCuts,
} from '../model/socketPatterns'
import { beginPanelPick } from './panelPicker'

const edgeLabel = (axis: 0 | 1 | 2) =>
  axis === 0 ? 'linker Kante' : axis === 1 ? 'unterer Kante' : 'vorderer Kante'

export function SocketPatternDialog({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const panels = useEditor((state) => state.panels)
  const selectedPanels = useEditor((state) => state.selectedPanels)
  const materials = useEditor((state) => state.materials)
  const patterns = useEditor((state) => state.socketPatterns)
  const create = useEditor((state) => state.createSocketPattern)
  const updateInstance = useEditor((state) => state.updateSocketInstance)
  const remove = useEditor((state) => state.removeSocketPattern)
  const transfer = useEditor((state) => state.transferSocketPattern)
  const setJointPreview = useEditor((state) => state.setJointPreview)
  const panel =
    selectedPanels.length === 1
      ? panels.find((candidate) => candidate.id === selectedPanels[0])
      : undefined
  const panelPatterns = patterns.filter(
    (pattern) => pattern.panelId === panel?.id,
  )
  const panelPlaneAxes = panel
    ? ([0, 1, 2] as const).filter((axis) => axis !== thinAxis(panel))
    : []
  const draftDistributionAxis = panel
    ? panel.size[panelPlaneAxes[0]] >= panel.size[panelPlaneAxes[1]]
      ? panelPlaneAxes[0]
      : panelPlaneAxes[1]
    : 0
  const [count, setCount] = useState(4)
  const [span, setSpan] = useState(60)
  const [distributionMode, setDistributionMode] = useState<'even' | 'span'>(
    'even',
  )
  const [length, setLength] = useState(15)
  const [clearance, setClearance] = useState(0.2)
  const [socketType, setSocketType] = useState<'cross' | 'through'>('cross')
  const [entrySide, setEntrySide] = useState<'positive' | 'negative'>(
    'positive',
  )
  const [depthPercent, setDepthPercent] = useState(50)
  const [materialId, setMaterialId] = useState('birch-3')
  const [draftTargetId, setDraftTargetId] = useState('')
  const [targetId, setTargetId] = useState('')
  const [pickingTarget, setPickingTarget] = useState(false)
  const [transferPreview, setTransferPreview] = useState<{
    patternId: string
    mode: 'copy' | 'mirror'
  } | null>(null)
  const [lastAppliedDraft, setLastAppliedDraft] = useState<string | null>(null)
  const effectiveSpan =
    panel && distributionMode === 'even'
      ? panel.size[draftDistributionAxis] *
        ((Math.max(1, Math.round(count)) - 1) /
          (Math.max(1, Math.round(count)) + 1))
      : span
  const draftKey = JSON.stringify([
    panel?.id,
    count,
    effectiveSpan,
    length,
    clearance,
    socketType,
    entrySide,
    depthPercent,
    materialId,
  ])
  useEffect(() => {
    if (open) setLastAppliedDraft(null)
  }, [open])
  useEffect(() => {
    if (!open) return
    const host = document.querySelector<HTMLElement>('.properties-panel')
    const previousScrollTop = host?.scrollTop ?? 0
    if (host) host.scrollTop = 0
    host?.classList.add('socket-wizard-open')
    return () => {
      host?.classList.remove('socket-wizard-open')
      if (host) host.scrollTop = previousScrollTop
    }
  }, [open])
  useEffect(() => {
    if (!open) return
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (pickingTarget) setPickingTarget(false)
      else onClose()
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose, open, pickingTarget])
  useEffect(() => {
    if (!open || !pickingTarget || !panel) return
    return beginPanelPick((panelId) => {
      if (panelId === panel.id) return false
      if (transferPreview?.patternId === '__draft__') setDraftTargetId(panelId)
      else setTargetId(panelId)
      setTransferPreview((current) =>
        current ? { ...current, mode: 'copy' } : current,
      )
      setPickingTarget(false)
      return true
    })
  }, [open, panel, pickingTarget, transferPreview?.patternId])
  const previewPattern = useMemo(() => {
    if (!open || !panel || lastAppliedDraft === draftKey) return null
    return buildSocketPattern(
      panel,
      {
        count,
        span: effectiveSpan,
        slotLength: length,
        targetThickness:
          materials.find((material) => material.id === materialId)?.thickness ??
          3,
        clearance,
        socketType,
        entrySide,
        depthRatio: depthPercent / 100,
      },
      '__socket-pattern-preview__',
      'Live-Vorschau',
    )
  }, [
    open,
    panel,
    count,
    effectiveSpan,
    length,
    materials,
    materialId,
    clearance,
    socketType,
    entrySide,
    depthPercent,
    lastAppliedDraft,
    draftKey,
  ])
  const targetPreview = useMemo(() => {
    if (!open || !transferPreview) return null
    const previewTargetId =
      transferPreview.patternId === '__draft__' ? draftTargetId : targetId
    if (!previewTargetId) return null
    const source =
      transferPreview.patternId === '__draft__'
        ? previewPattern
        : patterns.find((pattern) => pattern.id === transferPreview.patternId)
    const sourcePanel = panels.find(
      (candidate) => candidate.id === source?.panelId,
    )
    const targetPanel = panels.find(
      (candidate) => candidate.id === previewTargetId,
    )
    if (
      !source ||
      !sourcePanel ||
      !targetPanel ||
      sourcePanel.id === targetPanel.id
    )
      return null
    const pattern = buildTransferredSocketPattern(
      source,
      sourcePanel,
      targetPanel,
      '__socket-transfer-preview__',
      transferPreview.mode,
    )
    return { pattern, panel: targetPanel }
  }, [
    draftTargetId,
    open,
    panels,
    patterns,
    previewPattern,
    targetId,
    transferPreview,
  ])
  useEffect(() => {
    if (!open) {
      setJointPreview(null)
      return
    }
    const preview = []
    if (panel && previewPattern)
      preview.push({
        panelId: panel.id,
        cuts: socketPatternCuts(previewPattern, panel),
        features: [],
        color: '#00d9ff',
      })
    if (targetPreview)
      preview.push({
        panelId: targetPreview.panel.id,
        cuts: socketPatternCuts(targetPreview.pattern, targetPreview.panel),
        features: [],
        color: '#ff4fd8',
      })
    setJointPreview(preview.length ? preview : null)
    return () => setJointPreview(null)
  }, [panel, previewPattern, setJointPreview, targetPreview])
  const applyDraft = (transferMode?: 'copy' | 'mirror') => {
    if (!panel) return
    const previousIds = new Set(
      useEditor.getState().socketPatterns.map((item) => item.id),
    )
    create({
      count,
      span: effectiveSpan,
      slotLength: length,
      targetThickness:
        materials.find((material) => material.id === materialId)?.thickness ??
        3,
      clearance,
      socketType,
      entrySide,
      depthRatio: depthPercent / 100,
    })
    const created = useEditor
      .getState()
      .socketPatterns.find((item) => !previousIds.has(item.id))
    if (created && draftTargetId && transferMode)
      transfer(created.id, draftTargetId, transferMode)
    setLastAppliedDraft(draftKey)
    setTransferPreview(null)
    setJointPreview(null)
  }
  if (!open) return null
  const content = (
    <section
      className="socket-dialog socket-sidebar"
      role="dialog"
      aria-modal="false"
    >
      <header>
        <div>
          <h2>Freie Aufnahmen</h2>
          <p>Steckplätze ohne vorhandenes Gegenbauteil verwalten.</p>
        </div>
        <button aria-label="Aufnahmen schließen" onClick={onClose}>
          <X />
        </button>
      </header>
      {!panel ? (
        <div className="confirm-detail">
          Wähle genau ein Trägerpanel aus, um dessen Aufnahmen zu bearbeiten.
        </div>
      ) : (
        <div className="socket-dialog-body">
          <h3>{panel.label}</h3>
          <section className="socket-new-section">
            <header>
              <div>
                <strong>Neue Aufnahmenreihe</strong>
                <small>
                  Änderungen werden sofort in der 3D-Ansicht angezeigt.
                </small>
              </div>
            </header>
            <div className="socket-type-fields">
              <label className="select-field">
                <span>Aufnahmetyp</span>
                <select
                  value={socketType}
                  onChange={(event) =>
                    setSocketType(event.target.value as 'cross' | 'through')
                  }
                >
                  <option value="cross">
                    Kreuzsteckaufnahme von einer Kante
                  </option>
                  <option value="through">Innenliegender Steckplatz</option>
                </select>
              </label>
              {socketType === 'cross' && (
                <label className="select-field">
                  <span>Einsteckkante</span>
                  <select
                    value={entrySide}
                    onChange={(event) =>
                      setEntrySide(
                        event.target.value as 'positive' | 'negative',
                      )
                    }
                  >
                    <option value="positive">Kante A</option>
                    <option value="negative">Gegenüberliegende Kante B</option>
                  </select>
                </label>
              )}
            </div>
            <label className="select-field socket-distribution-mode">
              <span>Verteilung</span>
              <select
                value={distributionMode}
                onChange={(event) =>
                  setDistributionMode(event.target.value as 'even' | 'span')
                }
              >
                <option value="even">Gleichmäßig über die gesamte Länge</option>
                <option value="span">Eigene Verteilspanne</option>
              </select>
            </label>
            <div className="profile-parameter-grid">
              <label>
                Anzahl
                <input
                  type="number"
                  min="1"
                  value={count}
                  onChange={(event) =>
                    setCount(Math.max(1, Number(event.target.value)))
                  }
                />
              </label>
              {distributionMode === 'span' && (
                <label>
                  Verteilspanne · mm
                  <input
                    type="number"
                    min="0"
                    value={span}
                    onChange={(event) => setSpan(Number(event.target.value))}
                  />
                </label>
              )}
              {socketType === 'through' ? (
                <label>
                  Aufnahmelänge · mm
                  <input
                    type="number"
                    min="0.1"
                    value={length}
                    onChange={(event) =>
                      setLength(Math.max(0.1, Number(event.target.value)))
                    }
                  />
                </label>
              ) : (
                <label>
                  Einschnitttiefe · %
                  <input
                    type="number"
                    min="5"
                    max="100"
                    value={depthPercent}
                    onChange={(event) =>
                      setDepthPercent(
                        Math.min(100, Math.max(5, Number(event.target.value))),
                      )
                    }
                  />
                </label>
              )}
              <label>
                Spiel · mm
                <input
                  type="number"
                  step="0.01"
                  value={clearance}
                  onChange={(event) => setClearance(Number(event.target.value))}
                />
              </label>
            </div>
            <label className="select-field socket-material-field">
              <span>Zielmaterial des Trenners</span>
              <select
                value={materialId}
                onChange={(event) => setMaterialId(event.target.value)}
              >
                {materials.map((material) => (
                  <option key={material.id} value={material.id}>
                    {material.name} · {material.thickness} mm
                  </option>
                ))}
              </select>
            </label>
            <div className="socket-transfer socket-draft-transfer">
              <strong>Optional auf eine weitere Platte übernehmen</strong>
              <div className="socket-target-control">
                <select
                  aria-label="Zielpanel für neue Aufnahmenreihe"
                  value={draftTargetId}
                  onChange={(event) => {
                    setDraftTargetId(event.target.value)
                    setTransferPreview({ patternId: '__draft__', mode: 'copy' })
                    setPickingTarget(false)
                  }}
                >
                  <option value="">Zielpanel wählen …</option>
                  {panels
                    .filter((candidate) => candidate.id !== panel.id)
                    .map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.label}
                      </option>
                    ))}
                </select>
                <button
                  className={`icon-button socket-pick-target${pickingTarget && transferPreview?.patternId === '__draft__' ? ' active' : ''}`}
                  title="Zielplatte im 3D-Modell auswählen"
                  aria-label="Zielplatte für neue Aufnahmenreihe im 3D-Modell auswählen"
                  onClick={() => {
                    setTransferPreview({ patternId: '__draft__', mode: 'copy' })
                    setPickingTarget((active) => !active)
                  }}
                >
                  <Pipette />
                </button>
              </div>
              <select
                aria-label="Übertragungsart für neue Aufnahmenreihe"
                disabled={!draftTargetId}
                value={
                  transferPreview?.patternId === '__draft__'
                    ? transferPreview.mode
                    : 'copy'
                }
                onChange={(event) =>
                  setTransferPreview({
                    patternId: '__draft__',
                    mode: event.target.value as 'copy' | 'mirror',
                  })
                }
              >
                <option value="copy">Identisch</option>
                <option value="mirror">Gespiegelt</option>
              </select>
            </div>
          </section>
          <div className="socket-existing-heading">
            <strong>Vorhandene Aufnahmenreihen</strong>
            <small>{panelPatterns.length} Reihen auf diesem Panel</small>
          </div>
          <div className="socket-dialog-list">
            {!panelPatterns.length && (
              <div className="socket-empty-state">
                Noch keine Aufnahmenreihe vorhanden.
              </div>
            )}
            {panelPatterns.map((pattern) => (
              <section className="socket-pattern-card" key={pattern.id}>
                <header>
                  <span>
                    <strong>{pattern.name}</strong>
                    <small>
                      {
                        pattern.instances.filter(
                          (instance) => !instance.deleted,
                        ).length
                      }{' '}
                      von {pattern.instances.length} Aufnahmen aktiv
                    </small>
                  </span>
                  <button
                    className="socket-remove-row"
                    title="Reihe entfernen"
                    onClick={() => remove(pattern.id)}
                  >
                    <Trash2 /> Entfernen
                  </button>
                </header>
                <details className="socket-instance-details">
                  <summary>Einzelpositionen bearbeiten</summary>
                  {pattern.instances.map((instance, index) => (
                    <div
                      className={`socket-instance${instance.deleted ? ' deleted' : ''}`}
                      key={instance.id}
                    >
                      <span>
                        Aufnahme {index + 1}
                        <small>
                          {instance.deleted
                            ? 'Deaktiviert'
                            : `Abstand von ${edgeLabel(pattern.distributionAxis)}`}
                        </small>
                      </span>
                      <label className="socket-position-input">
                        <input
                          type="number"
                          min="0"
                          max={panel.size[pattern.distributionAxis]}
                          step="0.5"
                          disabled={instance.deleted}
                          aria-label={`Abstand Aufnahme ${index + 1} von ${edgeLabel(pattern.distributionAxis)}`}
                          value={Number(
                            (
                              instance.basePosition +
                              instance.offset +
                              panel.size[pattern.distributionAxis] / 2
                            ).toFixed(2),
                          )}
                          onChange={(event) =>
                            updateInstance(pattern.id, instance.id, {
                              offset:
                                Number(event.target.value) -
                                panel.size[pattern.distributionAxis] / 2 -
                                instance.basePosition,
                            })
                          }
                        />
                        <em>mm</em>
                      </label>
                      <button
                        onClick={() =>
                          updateInstance(pattern.id, instance.id, {
                            deleted: !instance.deleted,
                          })
                        }
                      >
                        {instance.deleted ? 'Wiederherstellen' : 'Löschen'}
                      </button>
                      {!instance.deleted && instance.offset !== 0 && (
                        <button
                          onClick={() =>
                            updateInstance(pattern.id, instance.id, {
                              offset: 0,
                            })
                          }
                        >
                          Zurücksetzen
                        </button>
                      )}
                    </div>
                  ))}
                </details>
                <div className="socket-transfer">
                  <strong>Auf andere Platte übertragen</strong>
                  <div className="socket-target-control">
                    <select
                      aria-label="Zielpanel"
                      value={targetId}
                      onChange={(event) => {
                        setTargetId(event.target.value)
                        setTransferPreview({
                          patternId: pattern.id,
                          mode: 'copy',
                        })
                        setPickingTarget(false)
                      }}
                    >
                      <option value="">
                        {pickingTarget
                          ? 'Zielplatte im 3D-Modell anklicken …'
                          : 'Zielpanel wählen …'}
                      </option>
                      {panels
                        .filter((candidate) => candidate.id !== panel.id)
                        .map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {candidate.label}
                          </option>
                        ))}
                    </select>
                    <button
                      className={`icon-button socket-pick-target${pickingTarget ? ' active' : ''}`}
                      title={
                        pickingTarget
                          ? 'Auswahl im 3D-Modell abbrechen'
                          : 'Zielplatte im 3D-Modell auswählen'
                      }
                      aria-label={
                        pickingTarget
                          ? 'Zielauswahl abbrechen'
                          : 'Zielplatte im 3D-Modell auswählen'
                      }
                      aria-pressed={pickingTarget}
                      onClick={() => {
                        setTransferPreview({
                          patternId: pattern.id,
                          mode: 'copy',
                        })
                        setPickingTarget((active) => !active)
                      }}
                    >
                      <Pipette />
                    </button>
                  </div>
                  <select
                    aria-label={`Übertragungsart für ${pattern.name}`}
                    disabled={!targetId}
                    value={
                      transferPreview?.patternId === pattern.id
                        ? transferPreview.mode
                        : 'copy'
                    }
                    onChange={(event) =>
                      setTransferPreview({
                        patternId: pattern.id,
                        mode: event.target.value as 'copy' | 'mirror',
                      })
                    }
                  >
                    <option value="copy">Identisch</option>
                    <option value="mirror">Gespiegelt</option>
                  </select>
                  <button
                    className="secondary-button"
                    disabled={
                      !targetId ||
                      !pattern.instances.some((instance) => !instance.deleted)
                    }
                    title={
                      !pattern.instances.some((instance) => !instance.deleted)
                        ? 'Diese Reihe enthält keine aktiven Aufnahmen.'
                        : undefined
                    }
                    onFocus={() =>
                      setTransferPreview((current) =>
                        current?.patternId === pattern.id
                          ? current
                          : { patternId: pattern.id, mode: 'copy' },
                      )
                    }
                    onClick={() => {
                      transfer(
                        pattern.id,
                        targetId,
                        transferPreview?.patternId === pattern.id
                          ? transferPreview.mode
                          : 'copy',
                      )
                      setTransferPreview(null)
                    }}
                  >
                    Verknüpfen
                  </button>
                </div>
              </section>
            ))}
          </div>
        </div>
      )}
      <footer>
        {panel && (
          <button
            className="export-button socket-apply-draft"
            onClick={() =>
              applyDraft(
                draftTargetId
                  ? transferPreview?.patternId === '__draft__'
                    ? transferPreview.mode
                    : 'copy'
                  : undefined,
              )
            }
          >
            Erstellen
          </button>
        )}
        <button onClick={onClose}>Schließen</button>
      </footer>
    </section>
  )
  const propertiesPanel = document.querySelector('.properties-panel')
  return propertiesPanel ? createPortal(content, propertiesPanel) : content
}
