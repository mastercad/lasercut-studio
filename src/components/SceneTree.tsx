import { useEffect, useState } from 'react'
import {
  Box,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileDown,
  FolderPlus,
  Layers3,
  MoreVertical,
  Plus,
  Trash2,
  Type,
} from 'lucide-react'
import { useEditor } from '../store/editor'
import { ConfirmDialog } from './ConfirmDialog'
import type { PanelDefinition } from '../model/box'

function PanelTreeItem({
  panel,
  selected,
  onSelect,
  onVisibility,
  onRename,
}: {
  panel: PanelDefinition
  selected: boolean
  onSelect: (additive: boolean) => void
  onVisibility: () => void
  onRename: (name: string) => void
}) {
  const [name, setName] = useState(panel.label)
  useEffect(() => setName(panel.label), [panel.label])
  const commit = () => {
    const next = name.trim()
    if (next) onRename(next)
    else setName(panel.label)
  }
  return (
    <div
      role="button"
      tabIndex={0}
      className={`tree-item${selected ? ' selected' : ''}${panel.hidden ? ' hidden-tool' : ''}${panel.visible === false ? ' user-hidden' : ''}`}
      onClick={(event) =>
        onSelect(event.ctrlKey || event.metaKey || event.shiftKey)
      }
      onKeyDown={(event) => {
        if (event.key === ' ' || event.key === 'Enter')
          onSelect(event.ctrlKey || event.metaKey || event.shiftKey)
      }}
    >
      <span className="panel-dot" />
      <span className="panel-name">
        <input
          aria-label={`${panel.label} umbenennen`}
          value={name}
          onClick={(event) => event.stopPropagation()}
          onFocus={() => onSelect(false)}
          onChange={(event) => setName(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') {
              setName(panel.label)
              event.currentTarget.blur()
            }
          }}
        />
        {panel.hidden && <small>Ausgeblendet</small>}
      </span>
      <span
        className="visibility-action"
        title={
          panel.visible === false ? 'Objekt einblenden' : 'Objekt ausblenden'
        }
        onClick={(event) => {
          event.stopPropagation()
          onVisibility()
        }}
      >
        {panel.visible === false ? <EyeOff /> : <Eye />}
      </span>
    </div>
  )
}

function TextTreeItem({
  label,
  selected,
  onSelect,
}: {
  label: string
  selected: boolean
  onSelect: () => void
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      className={`tree-item text-object${selected ? ' selected' : ''}`}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === ' ' || event.key === 'Enter') onSelect()
      }}
    >
      <Type />
      <span className="panel-name">{label}</span>
      <span />
    </div>
  )
}

export function SceneTree() {
  const panels = useEditor((state) => state.panels)
  const groups = useEditor((state) => state.groups)
  const selected = useEditor((state) => state.selectedPanels)
  const selectedGroupId = useEditor((state) => state.selectedGroupId)
  const selectedTextId = useEditor((state) => state.selectedTextId)
  const laserTexts = useEditor((state) => state.laserTexts)
  const selectPanel = useEditor((state) => state.selectPanel)
  const selectLaserText = useEditor((state) => state.selectLaserText)
  const selectGroup = useEditor((state) => state.selectGroup)
  const createGroup = useEditor((state) => state.createGroup)
  const renameGroup = useEditor((state) => state.renameGroup)
  const renamePanel = useEditor((state) => state.renamePanel)
  const duplicateGroup = useEditor((state) => state.duplicateGroup)
  const deleteGroup = useEditor((state) => state.deleteGroup)
  const assignSelection = useEditor((state) => state.assignSelectionToGroup)
  const togglePanelVisibility = useEditor(
    (state) => state.togglePanelVisibility,
  )
  const toggleGroupVisibility = useEditor(
    (state) => state.toggleGroupVisibility,
  )
  const serializeGroup = useEditor((state) => state.serializeGroup)
  const setWorkspace = useEditor((state) => state.setWorkspace)
  const addShape = useEditor((state) => state.addShape)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const pendingDelete = groups.find((group) => group.id === pendingDeleteId)
  const saveGroup = (id: string, name: string) => {
    const contents = serializeGroup(id)
    if (!contents) return
    const url = URL.createObjectURL(
      new Blob([contents], { type: 'application/json' }),
    )
    const link = document.createElement('a')
    link.href = url
    link.download = `${name.replace(/[^a-zA-Z0-9_-]+/g, '_')}.lcs.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const prepareGroupExport = (id: string) => {
    selectGroup(id)
    setWorkspace('unfold')
  }
  const grouped = new Set(groups.flatMap((group) => group.panelIds))
  return (
    <aside className="scene-panel">
      <div className="panel-heading">
        <span>Projektgruppen</span>
        <Layers3 />
      </div>
      <div className="group-toolbar">
        <button onClick={createGroup}>
          <FolderPlus />{' '}
          {selected.length ? 'Aus Auswahl gruppieren' : 'Neue Gruppe'}
        </button>
        {selected.length > 0 && groups.length > 0 && (
          <select
            value={selectedGroupId ?? ''}
            onChange={(event) => assignSelection(event.target.value)}
          >
            <option value="" disabled>
              Auswahl zuordnen…
            </option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="group-tree">
        {groups.map((group) => {
          const isCollapsed = collapsed.has(group.id)
          const groupPanels = group.panelIds
            .map((id) => panels.find((panel) => panel.id === id))
            .filter(Boolean) as typeof panels
          const allChildrenVisible = groupPanels.every(
            (panel) => panel.visible !== false,
          )
          const fullyVisible = group.visible !== false && allChildrenVisible
          return (
            <section
              className={`project-group${selectedGroupId === group.id ? ' selected' : ''}`}
              key={group.id}
            >
              <div className="tree-root" onClick={() => selectGroup(group.id)}>
                <button
                  onClick={(event) => {
                    event.stopPropagation()
                    setCollapsed((current) => {
                      const next = new Set(current)
                      next.has(group.id)
                        ? next.delete(group.id)
                        : next.add(group.id)
                      return next
                    })
                  }}
                >
                  {isCollapsed ? <ChevronRight /> : <ChevronDown />}
                </button>
                <Box />
                <input
                  value={group.name}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) =>
                    renameGroup(group.id, event.target.value)
                  }
                />
                <button
                  title={
                    fullyVisible
                      ? 'Baugruppe ausblenden'
                      : 'Alle Teile der Baugruppe einblenden'
                  }
                  onClick={(event) => {
                    event.stopPropagation()
                    toggleGroupVisibility(group.id)
                  }}
                >
                  {fullyVisible ? <Eye /> : <EyeOff />}
                </button>
                <div className="group-menu">
                  <button
                    title="Weitere Aktionen"
                    onClick={(event) => {
                      event.stopPropagation()
                      setOpenMenuId((current) =>
                        current === group.id ? null : group.id,
                      )
                    }}
                  >
                    <MoreVertical />
                  </button>
                  {openMenuId === group.id && (
                    <div
                      className="group-menu-popover"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <button
                        onClick={() => {
                          duplicateGroup(group.id)
                          setOpenMenuId(null)
                        }}
                      >
                        <Copy />
                        Baugruppe kopieren
                      </button>
                      <button
                        onClick={() => {
                          saveGroup(group.id, group.name)
                          setOpenMenuId(null)
                        }}
                      >
                        <FileDown />
                        Als Projekt speichern
                      </button>
                      <button
                        onClick={() => {
                          prepareGroupExport(group.id)
                          setOpenMenuId(null)
                        }}
                      >
                        <Download />
                        In Fertigung öffnen
                      </button>
                      <span />
                      <button
                        className="danger"
                        onClick={() => {
                          setPendingDeleteId(group.id)
                          setOpenMenuId(null)
                        }}
                      >
                        <Trash2 />
                        Baugruppe löschen
                      </button>
                    </div>
                  )}
                </div>
              </div>
              {!isCollapsed && (
                <div className="tree-children">
                  {groupPanels.map((panel) => (
                    <div className="tree-object-stack" key={panel.id}>
                      <PanelTreeItem
                        panel={panel}
                        selected={selected.includes(panel.id)}
                        onSelect={(additive) => selectPanel(panel.id, additive)}
                        onVisibility={() => togglePanelVisibility(panel.id)}
                        onRename={(name) => renamePanel(panel.id, name)}
                      />
                      {laserTexts
                        .filter((text) => text.panelId === panel.id)
                        .map((text) => (
                          <TextTreeItem
                            key={text.id}
                            label={text.label}
                            selected={selectedTextId === text.id}
                            onSelect={() => selectLaserText(text.id)}
                          />
                        ))}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )
        })}
        {panels.some((panel) => !grouped.has(panel.id)) && (
          <section className="project-group ungrouped">
            <div className="tree-root">
              <ChevronDown />
              <Box />
              <strong>Nicht gruppiert</strong>
              <span />
              <span />
            </div>
            <div className="tree-children">
              {panels
                .filter((panel) => !grouped.has(panel.id))
                .map((panel) => (
                  <PanelTreeItem
                    key={panel.id}
                    panel={panel}
                    selected={selected.includes(panel.id)}
                    onSelect={(additive) => selectPanel(panel.id, additive)}
                    onVisibility={() => togglePanelVisibility(panel.id)}
                    onRename={(name) => renamePanel(panel.id, name)}
                  />
                ))}
            </div>
          </section>
        )}
      </div>
      <div className="add-panel-group">
        <Plus />
        <select
          defaultValue=""
          aria-label="Objekt hinzufügen"
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
            Neues Objekt…
          </option>
          <option value="rectangle">Rechteck</option>
          <option value="triangle">Dreieck</option>
          <option value="circle">Kreis</option>
          <option value="star">Stern</option>
          <option value="polygon">Vieleck</option>
          <option value="text">Text</option>
        </select>
      </div>
      <div className="scene-stats">
        <span>
          {groups.length} Gruppen · {panels.length} Platten
        </span>
        <span>mm</span>
      </div>
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Baugruppe löschen?"
        description={`„${pendingDelete?.name ?? ''}“ und alle ${pendingDelete?.panelIds.length ?? 0} enthaltenen Objekte werden gelöscht.`}
        confirmLabel="Baugruppe löschen"
        onCancel={() => setPendingDeleteId(null)}
        onConfirm={() => {
          if (pendingDelete) deleteGroup(pendingDelete.id)
          setPendingDeleteId(null)
        }}
      />
    </aside>
  )
}
