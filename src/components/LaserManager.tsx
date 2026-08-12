import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, ChevronLeft, Cpu, Plus } from 'lucide-react'
import { useEditor } from '../store/editor'

type RecipeDraft = {
  color: string
  speed: number
  power: number
  passes: number
  airAssist: boolean
  lineInterval: number
  focusOffset: number
}
const emptyDraft = (color = '#d000d0'): RecipeDraft => ({
  color,
  speed: 100,
  power: 20,
  passes: 1,
  airAssist: false,
  lineInterval: 0.1,
  focusOffset: 0,
})

export function LaserManager() {
  const lasers = useEditor((state) => state.laserCutters)
  const presets = useEditor((state) => state.laserPresets)
  const profiles = useEditor((state) => state.processingProfiles)
  const recipes = useEditor((state) => state.processingRecipes)
  const materials = useEditor((state) => state.materials)
  const panels = useEditor((state) => state.panels)
  const activeId = useEditor((state) => state.activeLaserId)
  const selectLaser = useEditor((state) => state.selectLaserCutter)
  const updateLaser = useEditor((state) => state.updateLaserCutter)
  const addLaser = useEditor((state) => state.addLaserCutter)
  const updateCutLayer = useEditor((state) => state.updateCutLayer)
  const updateRecipe = useEditor((state) => state.updateProcessingRecipe)
  const active = lasers.find((laser) => laser.id === activeId) ?? lasers[0]
  const usedMaterialIds = useMemo(
    () =>
      new Set(
        panels
          .filter((panel) => !panel.hidden && panel.visible !== false)
          .map((panel) => panel.materialId)
          .filter(Boolean),
      ),
    [panels],
  )
  const availableMaterials = materials.filter((material) =>
    usedMaterialIds.has(material.id),
  )
  const materialOptions = availableMaterials.length
    ? availableMaterials
    : materials
  const [materialId, setMaterialId] = useState(materialOptions[0]?.id ?? '')
  const [editing, setEditing] = useState<
    'cut-inner' | 'cut-outer' | string | null
  >(null)
  const [draft, setDraft] = useState<RecipeDraft>(emptyDraft())
  const [machineOpen, setMachineOpen] = useState(false)
  const [machineName, setMachineName] = useState(active?.name ?? '')
  const [watts, setWatts] = useState(active?.powerWatts ?? 10)
  const [bedWidth, setBedWidth] = useState(active?.bedWidth ?? 400)
  const [bedHeight, setBedHeight] = useState(active?.bedHeight ?? 400)
  const [unit, setUnit] = useState<'mm/min' | 'mm/s'>(
    active?.speedUnit ?? 'mm/min',
  )
  const [notes, setNotes] = useState(active?.notes ?? '')
  useEffect(() => {
    if (active) {
      setMachineName(active.name)
      setWatts(active.powerWatts)
      setBedWidth(active.bedWidth ?? 400)
      setBedHeight(active.bedHeight ?? 400)
      setUnit(active.speedUnit)
      setNotes(active.notes)
      setEditing(null)
    }
  }, [active?.id])
  useEffect(() => {
    if (!materialOptions.some((material) => material.id === materialId))
      setMaterialId(materialOptions[0]?.id ?? '')
  }, [materialId, materialOptions])
  if (!active) return null
  const material = materials.find((candidate) => candidate.id === materialId)
  const assignedProfileIds = new Set(
    panels
      .filter(
        (panel) =>
          !panel.hidden &&
          panel.visible !== false &&
          panel.materialId === materialId,
      )
      .flatMap(
        (panel) =>
          panel.processingAssignments?.map(
            (assignment) => assignment.profileId,
          ) ?? [],
      ),
  )
  const relevantProfiles = [...profiles]
    .filter((profile) => assignedProfileIds.has(profile.id))
    .sort((a, b) => a.order - b.order)
  const innerCut = presets.find(
    (preset) =>
      preset.laserId === active.id &&
      preset.materialId === materialId &&
      preset.operation === 'cut-inner',
  )
  const outerCut = presets.find(
    (preset) =>
      preset.laserId === active.id &&
      preset.materialId === materialId &&
      preset.operation === 'cut-outer',
  )
  const hasAutomaticCuts = panels.some(
    (panel) =>
      !panel.hidden &&
      panel.visible !== false &&
      panel.materialId === materialId &&
      panel.autoCut !== false,
  )
  const missingCount =
    relevantProfiles.filter(
      (profile) =>
        !recipes.some(
          (recipe) =>
            recipe.profileId === profile.id &&
            recipe.laserId === active.id &&
            recipe.materialId === materialId,
        ),
    ).length +
    (hasAutomaticCuts && !innerCut ? 1 : 0) +
    (hasAutomaticCuts && !outerCut ? 1 : 0)

  const beginCut = (operation: 'cut-inner' | 'cut-outer') => {
    const preset = operation === 'cut-inner' ? innerCut : outerCut
    const color = operation === 'cut-inner' ? '#00b000' : '#c0a000'
    setDraft(
      preset
        ? {
            color: preset.layerColor ?? color,
            speed: preset.speed,
            power: preset.power,
            passes: preset.passes,
            airAssist: preset.airAssist,
            lineInterval: 0.1,
            focusOffset: 0,
          }
        : emptyDraft(color),
    )
    setEditing(operation)
  }
  const beginProfile = (profileId: string) => {
    const profile = profiles.find((candidate) => candidate.id === profileId)!
    const recipe = recipes.find(
      (candidate) =>
        candidate.profileId === profileId &&
        candidate.laserId === active.id &&
        candidate.materialId === materialId,
    )
    setDraft(
      recipe
        ? {
            color: recipe.layerColor,
            speed: recipe.speed,
            power: recipe.power,
            passes: recipe.passes,
            airAssist: recipe.airAssist,
            lineInterval: recipe.lineInterval,
            focusOffset: recipe.focusOffset,
          }
        : emptyDraft(profile.color),
    )
    setEditing(profileId)
  }
  const save = () => {
    if (!material) return
    if (editing === 'cut-inner' || editing === 'cut-outer') {
      updateCutLayer(active.id, material.id, editing, {
        layerColor: draft.color,
        speed: draft.speed,
        power: draft.power,
        passes: draft.passes,
        airAssist: draft.airAssist,
      })
    } else if (editing) {
      updateRecipe(editing, active.id, material.id, {
        layerColor: draft.color,
        speed: draft.speed,
        power: draft.power,
        passes: draft.passes,
        airAssist: draft.airAssist,
        lineInterval: draft.lineInterval,
        focusOffset: draft.focusOffset,
      })
    }
    setEditing(null)
  }
  const editingProfile =
    editing && editing !== 'cut-inner' && editing !== 'cut-outer'
      ? profiles.find((profile) => profile.id === editing)
      : null
  const editingCutName =
    editing === 'cut-inner'
      ? 'Innenschnitte'
      : editing === 'cut-outer'
        ? 'Außenschnitte'
        : null

  return (
    <aside className="laser-manager focused-layer-manager">
      <div className="laser-manager-title">
        <Cpu />
        <div>
          <h3>Layer-Einstellungen</h3>
          <p>Werte und Farben der tatsächlich erzeugten Laser-Layer</p>
        </div>
      </div>
      <label>
        <span>Laser</span>
        <select
          value={active.id}
          onChange={(event) => selectLaser(event.target.value)}
        >
          {lasers.map((laser) => (
            <option key={laser.id} value={laser.id}>
              {laser.name} · {laser.powerWatts} W
            </option>
          ))}
        </select>
      </label>
      <button
        className="machine-details-toggle"
        onClick={() => setMachineOpen((open) => !open)}
      >
        {machineOpen ? 'Maschinendaten schließen' : 'Maschinendaten bearbeiten'}
      </button>
      {machineOpen && (
        <div className="machine-details-panel">
          <label>
            <span>Name</span>
            <input
              value={machineName}
              onChange={(event) => setMachineName(event.target.value)}
            />
          </label>
          <div className="laser-pair">
            <label>
              <span>Leistung</span>
              <input
                type="number"
                min="1"
                value={watts}
                onChange={(event) =>
                  setWatts(Math.max(1, Number(event.target.value)))
                }
              />
            </label>
            <label>
              <span>Einheit</span>
              <select
                value={unit}
                onChange={(event) => setUnit(event.target.value as typeof unit)}
              >
                <option value="mm/min">mm/min</option>
                <option value="mm/s">mm/s</option>
              </select>
            </label>
          </div>
          <div className="laser-pair">
            <label>
              <span>Arbeitsbereich X (mm)</span>
              <input
                type="number"
                min="1"
                value={bedWidth}
                onChange={(event) =>
                  setBedWidth(Math.max(1, Number(event.target.value)))
                }
              />
            </label>
            <label>
              <span>Arbeitsbereich Y (mm)</span>
              <input
                type="number"
                min="1"
                value={bedHeight}
                onChange={(event) =>
                  setBedHeight(Math.max(1, Number(event.target.value)))
                }
              />
            </label>
          </div>
          <label>
            <span>Notizen</span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>
          <div className="laser-buttons">
            <button
              onClick={() =>
                updateLaser(active.id, {
                  name: machineName.trim() || 'Lasercutter',
                  powerWatts: watts,
                  bedWidth,
                  bedHeight,
                  speedUnit: unit,
                  notes,
                })
              }
            >
              Speichern
            </button>
            <button
              title="Neue Maschine als Kopie"
              onClick={() =>
                addLaser({
                  name: `${machineName.trim() || 'Lasercutter'} Kopie`,
                  powerWatts: watts,
                  bedWidth,
                  bedHeight,
                  speedUnit: unit,
                  notes,
                })
              }
            >
              <Plus />
            </button>
          </div>
        </div>
      )}

      <label className="material-focus">
        <span>Material</span>
        <select
          value={materialId}
          onChange={(event) => {
            setMaterialId(event.target.value)
            setEditing(null)
          }}
        >
          {materialOptions.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name} · {entry.thickness} mm
            </option>
          ))}
        </select>
      </label>
      {material && !editing && (
        <div className="layer-mapping-overview">
          <header>
            <strong>Bearbeitungsschritte</strong>
            <span className={missingCount ? 'incomplete' : 'complete'}>
              {missingCount ? `${missingCount} nachzupflegen` : 'Vollständig'}
            </span>
          </header>
          {relevantProfiles.map((profile) => {
            const recipe = recipes.find(
              (candidate) =>
                candidate.profileId === profile.id &&
                candidate.laserId === active.id &&
                candidate.materialId === material.id,
            )
            return (
              <button
                className={`layer-mapping-row${recipe ? '' : ' missing'}`}
                key={profile.id}
                onClick={() => beginProfile(profile.id)}
              >
                <span className="mapping-status">
                  {recipe ? <Check /> : <AlertTriangle />}
                </span>
                <span>
                  <strong>{profile.name}</strong>
                  <small>
                    {profile.geometry === 'fill' ? 'Fläche' : 'Kontur'}
                    {profile.referenceDepth !== undefined
                      ? ` · Ziel ca. ${profile.referenceDepth} mm`
                      : ''}
                  </small>
                </span>
                <em>{recipe ? 'Bearbeiten' : 'Einrichten'}</em>
              </button>
            )
          })}
          {hasAutomaticCuts && (
            <>
              <button
                className={`layer-mapping-row${innerCut ? '' : ' missing'}`}
                onClick={() => beginCut('cut-inner')}
              >
                <span className="mapping-status">
                  {innerCut ? <Check /> : <AlertTriangle />}
                </span>
                <span>
                  <strong>Innenschnitte</strong>
                  <small>
                    Automatisch erkannte Aussparungen · vor den Außenkonturen
                  </small>
                </span>
                <em>{innerCut ? 'Bearbeiten' : 'Einrichten'}</em>
              </button>
              <button
                className={`layer-mapping-row${outerCut ? '' : ' missing'}`}
                onClick={() => beginCut('cut-outer')}
              >
                <span className="mapping-status">
                  {outerCut ? <Check /> : <AlertTriangle />}
                </span>
                <span>
                  <strong>Außenschnitte</strong>
                  <small>
                    Automatisch erkannte Außenkonturen · letzter Schnittschritt
                  </small>
                </span>
                <em>{outerCut ? 'Bearbeiten' : 'Einrichten'}</em>
              </button>
            </>
          )}
          {!relevantProfiles.length && !hasAutomaticCuts && (
            <div className="no-project-profiles">
              Für dieses Material entstehen im aktuellen Projekt keine
              Laser-Layer.
            </div>
          )}
        </div>
      )}

      {material && editing && (
        <div className="layer-recipe-editor">
          <button className="recipe-back" onClick={() => setEditing(null)}>
            <ChevronLeft />
            Zur Übersicht
          </button>
          <header>
            <i style={{ background: draft.color }} />
            <div>
              <strong>{editingCutName ?? editingProfile?.name}</strong>
              <small>
                {active.name} · {material.name} {material.thickness} mm
              </small>
            </div>
          </header>
          <label className="recipe-color">
            <span>LightBurn-Layerfarbe</span>
            <input
              type="color"
              value={draft.color}
              onChange={(event) =>
                setDraft({ ...draft, color: event.target.value })
              }
            />
          </label>
          <label>
            <span>Geschwindigkeit</span>
            <div className="recipe-number">
              <input
                type="number"
                min="0"
                value={draft.speed}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    speed: Math.max(0, Number(event.target.value)),
                  })
                }
              />
              <em>{active.speedUnit}</em>
            </div>
          </label>
          <label>
            <span>Leistung</span>
            <div className="recipe-number">
              <input
                type="number"
                min="0"
                max="100"
                value={draft.power}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    power: Math.min(
                      100,
                      Math.max(0, Number(event.target.value)),
                    ),
                  })
                }
              />
              <em>%</em>
            </div>
          </label>
          <label>
            <span>Durchgänge</span>
            <div className="recipe-number">
              <input
                type="number"
                min="1"
                value={draft.passes}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    passes: Math.max(1, Number(event.target.value)),
                  })
                }
              />
              <em>×</em>
            </div>
          </label>
          {!editingCutName && (
            <>
              <label>
                <span>Linienabstand</span>
                <div className="recipe-number">
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={draft.lineInterval}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        lineInterval: Math.max(
                          0.01,
                          Number(event.target.value),
                        ),
                      })
                    }
                  />
                  <em>mm</em>
                </div>
              </label>
              <label>
                <span>Fokusversatz</span>
                <div className="recipe-number">
                  <input
                    type="number"
                    step="0.1"
                    value={draft.focusOffset}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        focusOffset: Number(event.target.value),
                      })
                    }
                  />
                  <em>mm</em>
                </div>
              </label>
            </>
          )}
          <label className="recipe-air">
            <input
              type="checkbox"
              checked={draft.airAssist}
              onChange={(event) =>
                setDraft({ ...draft, airAssist: event.target.checked })
              }
            />
            <span>Air Assist</span>
          </label>
          <div className="recipe-actions">
            <button onClick={() => setEditing(null)}>Abbrechen</button>
            <button className="primary" onClick={save}>
              Layer-Einstellungen speichern
            </button>
          </div>
        </div>
      )}
    </aside>
  )
}
