import { AlertTriangle, ChevronDown, ChevronUp, Ruler } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  analyzeDesignIntegrity,
  type DesignIntegrityFinding,
} from '../model/designIntegrity'
import { useEditor } from '../store/editor'

export function DesignIntegrityPanel() {
  const panels = useEditor((state) => state.panels)
  const materials = useEditor((state) => state.materials)
  const socketPatterns = useEditor((state) => state.socketPatterns)
  const crossJoints = useEditor((state) => state.crossJoints)
  const selectPanel = useEditor((state) => state.selectPanel)
  const setInspectionFocus = useEditor((state) => state.setInspectionFocus)
  const [findings, setFindings] = useState<DesignIntegrityFinding[]>([])
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFindings(
        analyzeDesignIntegrity(panels, materials, socketPatterns, crossJoints),
      )
    }, 180)
    return () => window.clearTimeout(timer)
  }, [crossJoints, materials, panels, socketPatterns])

  const relevant = useMemo(
    () =>
      findings.filter(
        (finding) =>
          finding.severity === 'error' || finding.severity === 'measurement',
      ),
    [findings],
  )
  if (!relevant.length) return null
  const errors = relevant.filter((finding) => finding.severity === 'error')

  const inspect = (finding: DesignIntegrityFinding) => {
    const panel = panels.find((candidate) => candidate.id === finding.panelId)
    if (!panel) return
    selectPanel(panel.id)
    const cut = panel.cuts.find((candidate) =>
      finding.cutIds.includes(candidate.id),
    )
    if (cut)
      setInspectionFocus({
        requestId: Date.now(),
        sourceId: cut.id,
        panelId: panel.id,
        center: cut.center,
        size: cut.size,
      })
  }

  return (
    <aside
      className={`design-integrity${errors.length ? ' has-errors' : ''}`}
      aria-live="polite"
    >
      <button
        className="design-integrity-summary"
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
      >
        {errors.length ? <AlertTriangle /> : <Ruler />}
        <span>
          <strong>
            {errors.length
              ? `${errors.length} geometrische${errors.length === 1 ? 'r Fehler' : ' Fehler'}`
              : 'Konstruktionsprüfung'}
          </strong>
          <small>
            {errors.length
              ? 'Aussparungen trennen mindestens ein Bauteil.'
              : `${relevant.length} unterschrittene${relevant.length === 1 ? 's Mindestmaß' : ' Mindestmaße'}`}
          </small>
        </span>
        {expanded ? <ChevronUp /> : <ChevronDown />}
      </button>
      {expanded && (
        <div className="design-integrity-findings">
          {relevant.map((finding) => (
            <button key={finding.id} onClick={() => inspect(finding)}>
              <span className={`finding-mark ${finding.severity}`} />
              <span>
                <strong>
                  {finding.panelLabel} · {finding.title}
                </strong>
                <small>{finding.detail}</small>
              </span>
            </button>
          ))}
          <p>
            Die Grenzwerte stammen aus der Materialbibliothek. Ohne hinterlegte
            Mindestmaße werden keine Stabilitätswarnungen geraten.
          </p>
        </div>
      )}
    </aside>
  )
}
