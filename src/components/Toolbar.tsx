import {
  ArrowRight,
  Copy,
  FilePlus2,
  FileUp,
  FolderOpen,
  Grid3X3,
  Magnet,
  Move3D,
  Palette,
  Redo2,
  Rotate3D,
  Save,
  Scaling,
  SlidersHorizontal,
  Trash2,
  Undo2,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useEditor } from '../store/editor'
import { ConfirmDialog } from './ConfirmDialog'
import { SvgImportDialog } from './SvgImportDialog'
import { NewProjectDialog } from './NewProjectDialog'

const ToolButton = ({
  children,
  active,
  disabled,
  title,
  onClick,
}: {
  children: React.ReactNode
  active?: boolean
  disabled?: boolean
  title: string
  onClick?: () => void
}) => (
  <button
    className={`icon-button${active ? ' active' : ''}`}
    disabled={disabled}
    title={title}
    aria-label={title}
    onClick={onClick}
  >
    {children}
  </button>
)

export function Toolbar() {
  const [svgImportOpen, setSvgImportOpen] = useState(false)
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [transformSettingsOpen, setTransformSettingsOpen] = useState(false)
  const [svgImportFile, setSvgImportFile] = useState<File | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const selected = useEditor((state) => state.selectedPanels)
  const selectedTextId = useEditor((state) => state.selectedTextId)
  const removeSelected = useEditor((state) => state.removeSelected)
  const duplicateSelected = useEditor((state) => state.duplicateSelected)
  const transformMode = useEditor((state) => state.transformMode)
  const setTransformMode = useEditor((state) => state.setTransformMode)
  const geometrySelectionMode = useEditor(
    (state) => state.geometrySelectionMode,
  )
  const setGeometrySelectionMode = useEditor(
    (state) => state.setGeometrySelectionMode,
  )
  const addShape = useEditor((state) => state.addShape)
  const snapEnabled = useEditor((state) => state.snapEnabled)
  const toggleSnap = useEditor((state) => state.toggleSnap)
  const undo = useEditor((state) => state.undo)
  const redo = useEditor((state) => state.redo)
  const canUndo = useEditor((state) => state.canUndo)
  const canRedo = useEditor((state) => state.canRedo)
  const transformGridEnabled = useEditor((state) => state.transformGridEnabled)
  const toggleTransformGrid = useEditor((state) => state.toggleTransformGrid)
  const transformConstraint = useEditor((state) => state.transformConstraint)
  const setTransformConstraint = useEditor(
    (state) => state.setTransformConstraint,
  )
  const translationStep = useEditor((state) => state.translationStep)
  const setTranslationStep = useEditor((state) => state.setTranslationStep)
  const rotationStep = useEditor((state) => state.rotationStep)
  const setRotationStep = useEditor((state) => state.setRotationStep)
  const scaleStep = useEditor((state) => state.scaleStep)
  const setScaleStep = useEditor((state) => state.setScaleStep)
  const colorMode = useEditor((state) => state.colorMode)
  const setColorMode = useEditor((state) => state.setColorMode)
  const serializeProject = useEditor((state) => state.serializeProject)
  const loadProject = useEditor((state) => state.loadProject)
  const newProject = useEditor((state) => state.newProject)
  const setWorkspace = useEditor((state) => state.setWorkspace)
  const workspace = useEditor((state) => state.workspace)
  const missingFonts = useEditor((state) => state.missingFonts)
  const dismissMissingFonts = useEditor((state) => state.dismissMissingFonts)
  const saveProject = useCallback(() => {
    const blob = new Blob([serializeProject()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `lasercut-projekt-${new Date().toISOString().slice(0, 10)}.lcs.json`
    link.click()
    URL.revokeObjectURL(url)
  }, [serializeProject])
  useEffect(() => {
    const handleSaveShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's')
        return
      event.preventDefault()
      saveProject()
    }
    window.addEventListener('keydown', handleSaveShortcut)
    return () => window.removeEventListener('keydown', handleSaveShortcut)
  }, [saveProject])
  useEffect(() => {
    const handleDuplicateShortcut = (event: KeyboardEvent) => {
      if (
        !(event.ctrlKey || event.metaKey) ||
        event.key.toLowerCase() !== 'd' ||
        !useEditor.getState().selectedPanels.length
      )
        return
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      )
        return
      event.preventDefault()
      duplicateSelected()
    }
    window.addEventListener('keydown', handleDuplicateShortcut)
    return () => window.removeEventListener('keydown', handleDuplicateShortcut)
  }, [duplicateSelected])
  return (
    <>
      <SvgImportDialog
        open={svgImportOpen}
        initialFile={svgImportFile}
        onInitialFileRead={() => setSvgImportFile(null)}
        onClose={() => {
          setSvgImportFile(null)
          setSvgImportOpen(false)
        }}
      />
      <NewProjectDialog
        open={newProjectOpen}
        onCancel={() => setNewProjectOpen(false)}
        onChoose={(template) => {
          newProject(template)
          setNewProjectOpen(false)
        }}
      />
      <ConfirmDialog
        open={missingFonts.length > 0}
        title="Schriftarten fehlen"
        description="Das Projekt wurde importiert, aber nicht alle verwendeten Systemschriftarten sind auf diesem Gerät verfügbar."
        detail={`Fehlend: ${missingFonts.join(', ')}. Die Texte bleiben mit ihrem ursprünglichen Schriftnamen gespeichert. Installiere die Schrift oder wähle am Textobjekt eine vorhandene Ersatzschrift.`}
        confirmLabel="Verstanden"
        onConfirm={dismissMissingFonts}
        onCancel={dismissMissingFonts}
      />
      <header className="toolbar">
        <div className="brand">
          <div className="brand-mark">LC</div>
          <span>LaserCut Studio</span>
        </div>
        <div className="toolbar-group">
          <ToolButton
            title="Neues Projekt"
            onClick={() => setNewProjectOpen(true)}
          >
            <FilePlus2 />
          </ToolButton>
          <ToolButton
            title="Projektdatei öffnen"
            onClick={() => fileInput.current?.click()}
          >
            <FolderOpen />
          </ToolButton>
          <ToolButton title="Projektdatei speichern" onClick={saveProject}>
            <Save />
          </ToolButton>
          <input
            ref={fileInput}
            className="project-file-input"
            type="file"
            accept=".json,.lcs.json,.svg,.dxf,.lbrn,.lbrn2,application/json,image/svg+xml,application/dxf,application/xml,text/xml"
            onChange={async (event) => {
              const file = event.target.files?.[0]
              if (
                file?.name.toLowerCase().endsWith('.svg') ||
                file?.name.toLowerCase().endsWith('.dxf') ||
                file?.name.toLowerCase().endsWith('.lbrn') ||
                file?.name.toLowerCase().endsWith('.lbrn2') ||
                file?.type === 'image/svg+xml'
              ) {
                setSvgImportFile(file)
                setSvgImportOpen(true)
              } else if (file && !loadProject(await file.text()))
                window.alert(
                  'Diese Projektdatei konnte nicht geöffnet werden. Bitte eine .lcs.json-, SVG-, DXF-, LBRN- oder LBRN2-Datei auswählen.',
                )
              event.target.value = ''
            }}
          />
        </div>
        <div className="toolbar-group">
          <ToolButton
            title="Rückgängig (Ctrl+Z)"
            disabled={!canUndo}
            onClick={undo}
          >
            <Undo2 />
          </ToolButton>
          <ToolButton
            title="Wiederholen (Ctrl+Shift+Z)"
            disabled={!canRedo}
            onClick={redo}
          >
            <Redo2 />
          </ToolButton>
        </div>
        <button
          className="svg-import-button"
          onClick={() => setSvgImportOpen(true)}
        >
          <FileUp /> SVG/DXF/LightBurn importieren
        </button>
        <div className="toolbar-group tools">
          <div
            className="toolbar-geometry-mode"
            role="group"
            aria-label="Geometrieauswahl"
          >
            {(
              [
                ['object', 'Objekt'],
                ['face', 'Fläche'],
                ['edge', 'Kante'],
              ] as const
            ).map(([mode, label]) => (
              <button
                type="button"
                className={geometrySelectionMode === mode ? 'active' : ''}
                disabled={workspace !== 'model' || selected.length !== 1}
                title={
                  selected.length === 1
                    ? `${label} auswählen und bearbeiten`
                    : 'Für die Geometriebearbeitung genau ein Objekt auswählen'
                }
                key={mode}
                onClick={() => setGeometrySelectionMode(mode)}
              >
                {label}
              </button>
            ))}
          </div>
          <ToolButton
            title="Verschieben (G)"
            active={transformMode === 'translate'}
            onClick={() => setTransformMode('translate')}
          >
            <Move3D />
          </ToolButton>
          <ToolButton
            title="Drehen (R)"
            active={transformMode === 'rotate'}
            onClick={() => setTransformMode('rotate')}
          >
            <Rotate3D />
          </ToolButton>
          <ToolButton
            title="Skalieren (S)"
            active={transformMode === 'scale'}
            onClick={() => setTransformMode('scale')}
          >
            <Scaling />
          </ToolButton>
          <ToolButton
            title="Flächen-Snapping"
            active={snapEnabled}
            onClick={toggleSnap}
          >
            <Magnet />
          </ToolButton>
          <ToolButton
            title="Transformationsraster"
            active={transformGridEnabled}
            onClick={toggleTransformGrid}
          >
            <Grid3X3 />
          </ToolButton>
          <ToolButton
            title="Raster & Snapping einstellen"
            active={transformSettingsOpen}
            onClick={() => setTransformSettingsOpen((open) => !open)}
          >
            <SlidersHorizontal />
          </ToolButton>
          {transformSettingsOpen && (
            <div className="transform-settings-popover">
              <header>
                <div>
                  <strong>Raster &amp; Snapping</strong>
                  <small>Globale Editorsteuerung</small>
                </div>
                <button onClick={() => setTransformSettingsOpen(false)}>
                  ×
                </button>
              </header>
              <section>
                <span>Achsenbindung</span>
                <div className="toolbar-axis-grid">
                  {(['free', 'x', 'y', 'z', 'xy', 'xz', 'yz'] as const).map(
                    (constraint) => (
                      <button
                        type="button"
                        className={
                          transformConstraint === constraint ? 'active' : ''
                        }
                        key={constraint}
                        onClick={() => setTransformConstraint(constraint)}
                      >
                        {constraint === 'free'
                          ? 'Frei'
                          : constraint.toUpperCase()}
                      </button>
                    ),
                  )}
                </div>
              </section>
              <section className="toolbar-toggle-list">
                <button
                  className={snapEnabled ? 'active' : ''}
                  onClick={toggleSnap}
                >
                  <Magnet />
                  <span>
                    <strong>Flächen-Snapping</strong>
                    <small>{snapEnabled ? 'Aktiv' : 'Aus'}</small>
                  </span>
                </button>
                <button
                  className={transformGridEnabled ? 'active' : ''}
                  onClick={toggleTransformGrid}
                >
                  <Grid3X3 />
                  <span>
                    <strong>Transformationsraster</strong>
                    <small>{transformGridEnabled ? 'Aktiv' : 'Aus'}</small>
                  </span>
                </button>
              </section>
              <section className="toolbar-step-grid">
                <label>
                  <span>Bewegung</span>
                  <div>
                    <input
                      type="number"
                      min="0.1"
                      step="0.5"
                      value={translationStep}
                      onChange={(event) =>
                        setTranslationStep(Number(event.target.value))
                      }
                    />
                    <em>mm</em>
                  </div>
                </label>
                <label>
                  <span>Rotation</span>
                  <div>
                    <input
                      type="number"
                      min="0.1"
                      step="1"
                      value={rotationStep}
                      onChange={(event) =>
                        setRotationStep(Number(event.target.value))
                      }
                    />
                    <em>°</em>
                  </div>
                </label>
                <label>
                  <span>Skalierung</span>
                  <div>
                    <input
                      type="number"
                      min="0.1"
                      step="1"
                      value={Number((scaleStep * 100).toFixed(2))}
                      onChange={(event) =>
                        setScaleStep(Number(event.target.value) / 100)
                      }
                    />
                    <em>%</em>
                  </div>
                </label>
              </section>
              <footer>Rasterwerte greifen beim Transformieren mit Ctrl.</footer>
            </div>
          )}
          <ToolButton
            title={
              colorMode === 'object'
                ? 'Objektfarben aktiv'
                : 'Materialfarben aktiv'
            }
            active={colorMode === 'object'}
            onClick={() =>
              setColorMode(colorMode === 'object' ? 'material' : 'object')
            }
          >
            <Palette />
          </ToolButton>
          <select
            className="add-shape-select add-panel-select"
            defaultValue=""
            aria-label="Objekt hinzufügen"
            title="Objekt mit gewünschter Grundform hinzufügen"
            onChange={(event) => {
              if (event.target.value)
                addShape(
                  event.target.value as
                    | 'rectangle'
                    | 'triangle'
                    | 'circle'
                    | 'star'
                    | 'polygon'
                    | 'text',
                )
              event.target.value = ''
            }}
          >
            <option value="" disabled>
              + Objekt
            </option>
            <option value="rectangle">Rechteck</option>
            <option value="triangle">Dreieck</option>
            <option value="circle">Kreis</option>
            <option value="star">Stern</option>
            <option value="polygon">Vieleck</option>
            <option value="text">Text</option>
          </select>
          <button
            className="icon-button"
            title="Auswahl duplizieren (Ctrl+D)"
            aria-label="Auswahl duplizieren"
            disabled={!selected.length}
            onClick={duplicateSelected}
          >
            <Copy />
          </button>
          <button
            className="icon-button"
            title="Auswahl löschen"
            aria-label="Auswahl löschen"
            disabled={!selected.length && !selectedTextId}
            onClick={removeSelected}
          >
            <Trash2 />
          </button>
        </div>
        {workspace === 'model' && (
          <button
            className="export-button workflow-next"
            title="Bearbeitungsschritte prüfen und Export vorbereiten"
            onClick={() => setWorkspace('unfold')}
          >
            <span>Weiter zur Fertigung</span>
            <ArrowRight />
          </button>
        )}
      </header>
    </>
  )
}
