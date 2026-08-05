import { Box, File, X } from 'lucide-react'
import { useEffect } from 'react'

export function NewProjectDialog({
  open,
  onChoose,
  onCancel,
}: {
  open: boolean
  onChoose: (template: 'empty' | 'box') => void
  onCancel: () => void
}) {
  useEffect(() => {
    if (!open) return
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onCancel, open])
  if (!open) return null
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <section
        className="new-project-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-project-title"
      >
        <header>
          <div>
            <h2 id="new-project-title">Neues Projekt anlegen</h2>
            <p>
              Das aktuelle Projekt wird geschlossen. Speichere es vorher, wenn
              du es später noch benötigst.
            </p>
          </div>
          <button aria-label="Dialog schließen" onClick={onCancel}>
            <X />
          </button>
        </header>
        <div className="new-project-warning">
          Nicht gespeicherte Änderungen am aktuellen Projekt gehen verloren.
        </div>
        <div className="new-project-options">
          <button onClick={() => onChoose('empty')}>
            <i>
              <File />
            </i>
            <span>
              <strong>Leeres Projekt</strong>
              <small>
                Ohne Objekte beginnen – ideal für einen SVG-Import oder eigene
                Formen.
              </small>
            </span>
          </button>
          <button onClick={() => onChoose('box')}>
            <i>
              <Box />
            </i>
            <span>
              <strong>Standardbox</strong>
              <small>Mit einer Box in Standardmaßen beginnen.</small>
            </span>
          </button>
        </div>
        <footer>
          <button onClick={onCancel}>Abbrechen</button>
        </footer>
      </section>
    </div>
  )
}
