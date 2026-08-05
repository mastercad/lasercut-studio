import { useEffect } from 'react'
import { AlertTriangle, X } from 'lucide-react'

export function ConfirmDialog({
  open,
  title,
  description,
  detail,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  description: string
  detail?: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}) {
  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [open, onCancel])
  if (!open) return null
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <section
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-description"
      >
        <header>
          <div className="confirm-icon">
            <AlertTriangle />
          </div>
          <div>
            <h2 id="confirm-title">{title}</h2>
            <p id="confirm-description">{description}</p>
          </div>
          <button
            className="modal-close"
            aria-label="Dialog schließen"
            onClick={onCancel}
          >
            <X />
          </button>
        </header>
        {detail && <div className="confirm-detail">{detail}</div>}
        <footer>
          <button className="modal-cancel" autoFocus onClick={onCancel}>
            Abbrechen
          </button>
          <button className="modal-danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </footer>
      </section>
    </div>
  )
}
